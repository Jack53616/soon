import { query } from "../config/db.js";
import { validateTelegramId, validateAmount } from "../config/security.js";
import { processReferralBonus } from "./auth.controller.js";
import { 
  processAgentWithdrawalBonus, 
  handleReferredUserLeaving,
  markReferralAsDeposited,
  registerAgentReferral
} from "./agent.controller.js";

// ===== HELPER: Calculate withdrawal fee =====
// Fee is based on days since LAST withdrawal (or first deposit if never withdrawn)
// Fee resets every time user withdraws
// EXTRA: 3% fee on every $100 of withdrawal amount
export function calculateWithdrawalFee(user, amount) {
  const now = new Date();
  
  // Check if admin set a custom fee override for this user
  if (user.fee_override !== null && user.fee_override !== undefined) {
    const customRate = Number(user.fee_override);
    const baseFee = Number((amount * customRate / 100).toFixed(2));
    // Add 3% per $100 extra fee
    const extraFeeRate = 3;
    const extraFee = Number((Math.floor(amount / 100) * (100 * extraFeeRate / 100)).toFixed(2));
    // Turkey tax: 4% additional fee
    const turkeyTaxRate = (user.country === 'TR') ? 4 : 0;
    const turkeyTax = Number((amount * turkeyTaxRate / 100).toFixed(2));
    const totalFee = Number((baseFee + extraFee + turkeyTax).toFixed(2));
    const netAmount = Number((amount - totalFee).toFixed(2));
    return { 
      feeRate: customRate, 
      feeAmount: totalFee, 
      baseFee,
      extraFee,
      extraFeeRate,
      turkeyTax,
      turkeyTaxRate,
      netAmount, 
      daysSinceLastAction: 0, 
      feeLabel: customRate === 0 ? 'بدون رسوم (مخصص)' : `رسوم مخصصة ${customRate}%` 
    };
  }
  
  // Use last_withdrawal_at if exists, otherwise first_deposit_at
  const referenceDate = user.last_withdrawal_at 
    ? new Date(user.last_withdrawal_at) 
    : (user.first_deposit_at ? new Date(user.first_deposit_at) : now);
  
  const daysSinceLastAction = Math.floor((now - referenceDate) / (1000 * 60 * 60 * 24));
  
  let feeRate;
  let feeLabel;
  
  if (daysSinceLastAction <= 15) {
    feeRate = 25;
    feeLabel = 'خلال 15 يوم الأولى';
  } else if (daysSinceLastAction <= 30) {
    feeRate = 15;
    feeLabel = 'بين 16-30 يوم';
  } else if (daysSinceLastAction >= 90) {
    feeRate = 3;
    feeLabel = 'مستخدم وفي (90+ يوم)';
  } else {
    feeRate = 5;
    feeLabel = 'بعد 30 يوم';
  }
  
  const baseFee = Number((amount * feeRate / 100).toFixed(2));
  // Add 3% per $100 extra fee
  const extraFeeRate = 3;
  const extraFee = Number((Math.floor(amount / 100) * (100 * extraFeeRate / 100)).toFixed(2));
  
  // Turkey tax: 4% additional fee if user's country is Turkey
  const turkeyTaxRate = (user.country === 'TR') ? 4 : 0;
  const turkeyTax = Number((amount * turkeyTaxRate / 100).toFixed(2));
  
  const totalFee = Number((baseFee + extraFee + turkeyTax).toFixed(2));
  const netAmount = Number((amount - totalFee).toFixed(2));
  
  return { feeRate, feeAmount: totalFee, baseFee, extraFee, extraFeeRate, turkeyTax, turkeyTaxRate, netAmount, daysSinceLastAction, feeLabel };
}

export const getWallet = async (req, res) => {
  try {
    const { tg_id } = req.params;

    if (!validateTelegramId(tg_id)) {
      return res.status(400).json({ ok: false, error: "Invalid Telegram ID" });
    }

    const result = await query(
      "SELECT balance, frozen_balance, wins, losses FROM users WHERE tg_id = $1",
      [tg_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    res.json({ ok: true, wallet: result.rows[0] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const getOps = async (req, res) => {
  try {
    const { tg_id } = req.params;

    const userResult = await query("SELECT id FROM users WHERE tg_id = $1", [tg_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user_id = userResult.rows[0].id;

    const result = await query(
      "SELECT * FROM ops WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20",
      [user_id]
    );

    res.json({ ok: true, list: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const requestWithdraw = async (req, res) => {
  try {
    const { tg_id, amount, method, address: directAddress } = req.body;

    // Check if withdrawal is enabled
    const withdrawalSetting = await query(
      "SELECT value FROM settings WHERE key = 'withdrawal_enabled'"
    );
    const withdrawalEnabled = withdrawalSetting.rows.length === 0 || 
                               withdrawalSetting.rows[0].value !== 'false';
    
    if (!withdrawalEnabled) {
      return res.status(403).json({ 
        ok: false, 
        error: "تم توقيف السحب مؤقتاً بسبب الصيانة | Withdrawals temporarily disabled for maintenance" 
      });
    }

    if (!validateTelegramId(tg_id) || !validateAmount(amount)) {
      return res.status(400).json({ ok: false, error: "Invalid input" });
    }

    const userResult = await query("SELECT * FROM users WHERE tg_id = $1", [tg_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user = userResult.rows[0];

    if (user.balance < amount) {
      return res.status(400).json({ ok: false, error: "Insufficient balance" });
    }

    // Use direct address from request or get saved address
    let address = directAddress;
    
    if (!address) {
      const methodResult = await query(
        "SELECT address FROM withdraw_methods WHERE user_id = $1 AND method = $2",
        [user.id, method]
      );

      if (methodResult.rows.length === 0) {
        return res.status(400).json({ ok: false, error: "No saved address for this method" });
      }

      address = methodResult.rows[0].address;
    }
    
    if (!address || address.trim() === '') {
      return res.status(400).json({ ok: false, error: "Wallet address is required" });
    }

    // ===== Calculate withdrawal fee (hidden from user) =====
    const { feeRate, feeAmount, netAmount, daysSinceLastAction, feeLabel } = calculateWithdrawalFee(user, amount);
    
    if (netAmount <= 0) {
      return res.status(400).json({ 
        ok: false, 
        error: "المبلغ أقل من الحد الأدنى للسحب | Amount is below minimum withdrawal" 
      });
    }

    // Deduct balance and freeze it (full amount)
    await query(
      "UPDATE users SET balance = balance - $1, frozen_balance = frozen_balance + $1 WHERE id = $2",
      [amount, user.id]
    );

    // Create withdrawal request with fee info (stored internally, not shown to user)
    await query(
      `INSERT INTO requests (user_id, method, address, amount, fee_amount, fee_rate, net_amount, days_since_deposit) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [user.id, method, address, amount, feeAmount, feeRate, netAmount, daysSinceLastAction]
    );

    // Log operation (simple note, no fee details shown)
    await query(
      "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'withdraw', $2, $3)",
      [user.id, -amount, `طلب سحب | Withdrawal request`]
    );

    // ===== Update last_withdrawal_at to reset fee timer =====
    await query(
      "UPDATE users SET last_withdrawal_at = NOW() WHERE id = $1",
      [user.id]
    );

    // ===== Agent withdrawal bonus (2% if within first 30 days of referral) =====
    try {
      await processAgentWithdrawalBonus(user.id, amount);
    } catch (e) { /* ignore */ }

    // ===== Check if user is fully withdrawing (balance will be ~0) =====
    const remainingBalance = Number(user.balance) - Number(amount);
    if (remainingBalance < 1) {
      try {
        await handleReferredUserLeaving(user.id);
      } catch (e) { /* ignore */ }
    }

    // Response: NO fee details shown to user
    res.json({ 
      ok: true, 
      message: "تم تقديم طلب السحب بنجاح | Withdrawal request submitted successfully",
      amount: amount
    });
  } catch (error) {
    console.error("Withdraw error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const saveWithdrawMethod = async (req, res) => {
  try {
    const { tg_id, method, address } = req.body;

    const userResult = await query("SELECT id FROM users WHERE tg_id = $1", [tg_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user_id = userResult.rows[0].id;

    await query(
      `INSERT INTO withdraw_methods (user_id, method, address) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (user_id, method) 
       DO UPDATE SET address = $3, updated_at = NOW()`,
      [user_id, method, address]
    );

    res.json({ ok: true, message: "Address saved" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const cancelWithdraw = async (req, res) => {
  try {
    const { tg_id, id } = req.body;

    const userResult = await query("SELECT id FROM users WHERE tg_id = $1", [tg_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user_id = userResult.rows[0].id;

    const reqResult = await query(
      "SELECT * FROM requests WHERE id = $1 AND user_id = $2 AND status = 'pending'",
      [id, user_id]
    );

    if (reqResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Request not found or cannot be cancelled" });
    }

    const request = reqResult.rows[0];

    // Return frozen balance
    await query(
      "UPDATE users SET balance = balance + $1, frozen_balance = frozen_balance - $1 WHERE id = $2",
      [request.amount, user_id]
    );

    // Update request status
    await query(
      "UPDATE requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1",
      [id]
    );

    res.json({ ok: true, message: "Withdrawal cancelled" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const getRequests = async (req, res) => {
  try {
    const { tg_id } = req.params;

    const userResult = await query("SELECT id FROM users WHERE tg_id = $1", [tg_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user_id = userResult.rows[0].id;

    const result = await query(
      "SELECT id, method, address, amount, status, created_at, updated_at FROM requests WHERE user_id = $1 ORDER BY created_at DESC",
      [user_id]
    );

    // Return requests WITHOUT fee details
    res.json({ ok: true, list: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Deposit handler - processes referral bonus when user deposits
export const processDeposit = async (req, res) => {
  try {
    const { tg_id, amount } = req.body;

    if (!validateTelegramId(tg_id) || !validateAmount(amount)) {
      return res.status(400).json({ ok: false, error: "Invalid input" });
    }

    const userResult = await query("SELECT * FROM users WHERE tg_id = $1", [tg_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user = userResult.rows[0];

    const isFirstDeposit = !user.first_deposit_at;

    // Update balance and first deposit date
    await query(
      `UPDATE users SET balance = balance + $1, total_deposited = total_deposited + $1,
        first_deposit_at = COALESCE(first_deposit_at, NOW()),
        last_activity_at = NOW()
       WHERE id = $2`,
      [amount, user.id]
    );

    // Log operation
    await query(
      "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'deposit', $2, 'Deposit')",
      [user.id, amount]
    );

    // Process referral bonus if applicable
    try {
      await processReferralBonus(tg_id, amount);
    } catch (err) {
      console.error("Referral bonus processing error:", err.message);
    }

    // ===== Agent: Mark referral as deposited =====
    try {
      if (isFirstDeposit) {
        await markReferralAsDeposited(user.id, amount);
      }
    } catch (err) {
      console.error("Agent referral deposit error:", err.message);
    }

    res.json({ ok: true, message: "Deposit processed" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ===== API: Get withdrawal fee preview (available to users) =====
export const getWithdrawalFeePreview = async (req, res) => {
  try {
    const { tg_id, amount } = req.query;
    
    if (!validateTelegramId(tg_id)) {
      return res.status(400).json({ ok: false, error: "Invalid Telegram ID" });
    }
    
    const userResult = await query("SELECT * FROM users WHERE tg_id = $1", [tg_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }
    
    const user = userResult.rows[0];
    const parsedAmount = parseFloat(amount) || 0;
    
    const feeInfo = calculateWithdrawalFee(user, parsedAmount);
    
    res.json({ 
      ok: true, 
      amount: parsedAmount,
      feeRate: feeInfo.feeRate,
      baseFee: feeInfo.baseFee,
      extraFee: feeInfo.extraFee,
      extraFeeRate: feeInfo.extraFeeRate,
      turkeyTax: feeInfo.turkeyTax || 0,
      turkeyTaxRate: feeInfo.turkeyTaxRate || 0,
      totalFee: feeInfo.feeAmount,
      netAmount: feeInfo.netAmount,
      daysSinceLastAction: feeInfo.daysSinceLastAction,
      feeLabel: feeInfo.feeLabel
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ===== API: Set fee override for a specific user =====
export const setUserFeeOverride = async (req, res) => {
  try {
    const { user_id, fee_override } = req.body;
    
    // fee_override: null = default, 0 = no fee, number = custom %
    const feeValue = fee_override === null || fee_override === '' ? null : Number(fee_override);
    
    await query(
      "UPDATE users SET fee_override = $1 WHERE id = $2",
      [feeValue, user_id]
    );
    
    res.json({ ok: true, message: feeValue === null ? 'تم إزالة الخصم المخصص (سيتم استخدام الافتراضي)' : `تم تعيين خصم ${feeValue}% لهذا المستخدم` });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ===== API: Set fee override for ALL users =====
export const setAllUsersFeeOverride = async (req, res) => {
  try {
    const { fee_override } = req.body;
    
    const feeValue = fee_override === null || fee_override === '' ? null : Number(fee_override);
    
    const result = await query(
      "UPDATE users SET fee_override = $1",
      [feeValue]
    );
    
    res.json({ 
      ok: true, 
      message: feeValue === null 
        ? 'تم إزالة الخصم المخصص لجميع المستخدمين' 
        : `تم تعيين خصم ${feeValue}% لجميع المستخدمين`,
      affected: result.rowCount
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ===== API: Reset fee timer for a specific user =====
export const resetUserFeeTimer = async (req, res) => {
  try {
    const { user_id } = req.body;
    
    await query(
      "UPDATE users SET last_withdrawal_at = NULL WHERE id = $1",
      [user_id]
    );
    
    res.json({ ok: true, message: 'تم إعادة تعيين مؤقت الخصم لهذا المستخدم' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ===== API: Get user fee info (ADMIN) =====
export const getUserFeeInfo = async (req, res) => {
  try {
    const { user_id } = req.params;
    
    const result = await query(
      "SELECT id, tg_id, name, fee_override, first_deposit_at, last_withdrawal_at FROM users WHERE id = $1",
      [user_id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }
    
    const user = result.rows[0];
    const feeInfo = calculateWithdrawalFee(user, 100); // Calculate for $100 as example
    
    res.json({ 
      ok: true, 
      user: {
        id: user.id,
        tg_id: user.tg_id,
        name: user.name,
        fee_override: user.fee_override,
        first_deposit_at: user.first_deposit_at,
        last_withdrawal_at: user.last_withdrawal_at,
        current_fee_rate: feeInfo.feeRate,
        fee_label: feeInfo.feeLabel,
        days_since_last_action: feeInfo.daysSinceLastAction
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};
