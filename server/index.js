// index.js
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Admin Token
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'ql_admin_2025';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files (if exist)
app.use(express.static(path.join(__dirname, "client")));
app.use("/public", express.static(path.join(__dirname, "public")));

// =====================
// Mock Admin Data
// =====================
let mockUsers = [
  { id:1, name:'Jack', tg_id:'@jack', balance:100, sub_expires_at: new Date(Date.now()+7*24*60*60*1000).toISOString() },
  { id:2, name:'Alice', tg_id:'@alice', balance:50, sub_expires_at: new Date(Date.now()+3*24*60*60*1000).toISOString() }
];

let mockWithdrawals = [
  { id:1, user_id:1, amount:20, method:'USDT', status:'pending' }
];

let mockTrades = [
  { id:1, user_id:1, symbol:'BTCUSDT', status:'open', pnl:null },
  { id:2, user_id:2, symbol:'ETHUSDT', status:'closed', pnl:15 }
];

// =====================
// Admin stats endpoint
// =====================
app.get("/api/admin/stats", (req, res) => {
  const token = req.headers['x-admin-token'];
  if(token !== ADMIN_TOKEN) return res.status(401).json({ ok:false, error:'Invalid token' });

  res.json({
    ok: true,
    users: mockUsers.length,
    deposits: mockUsers.reduce((a,u)=>a+u.balance,0),
    withdrawals: mockWithdrawals.reduce((a,w)=>a+w.amount,0),
    open_trades: mockTrades.filter(t=>t.status==='open').length,
    recent: [
      { id:1,type:'إيداع',amount:50,note:'test',created_at:new Date().toISOString() },
      { id:2,type:'سحب',amount:20,note:'test',created_at:new Date().toISOString() }
    ]
  });
});

// =====================
// Admin users endpoint
// =====================
app.get("/api/admin/users", (req, res) => {
  const token = req.headers['x-admin-token'];
  if(token !== ADMIN_TOKEN) return res.status(401).json({ ok:false });

  const q = req.query.q || '';
  const items = mockUsers.filter(u => u.name.includes(q) || u.id.toString() === q);
  res.json({ ok:true, items });
});

app.post("/api/admin/users/:id/balance", (req, res) => {
  const token = req.headers['x-admin-token'];
  if(token !== ADMIN_TOKEN) return res.status(401).json({ ok:false });

  const id = Number(req.params.id);
  const { delta } = req.body;
  const user = mockUsers.find(u=>u.id===id);
  if(!user) return res.json({ ok:false, error:'User not found' });

  user.balance += delta;
  res.json({ ok:true });
});

// =====================
// Admin withdrawals endpoint
// =====================
app.get("/api/admin/withdrawals", (req, res) => {
  const token = req.headers['x-admin-token'];
  if(token !== ADMIN_TOKEN) return res.status(401).json({ ok:false });

  res.json({ ok:true, items: mockWithdrawals });
});

app.post("/api/admin/withdrawals/:id/approve", (req, res) => {
  const token = req.headers['x-admin-token'];
  if(token !== ADMIN_TOKEN) return res.status(401).json({ ok:false });

  const id = Number(req.params.id);
  const wd = mockWithdrawals.find(w=>w.id===id);
  if(!wd) return res.json({ ok:false });

  wd.status = 'approved';
  res.json({ ok:true });
});

app.post("/api/admin/withdrawals/:id/reject", (req, res) => {
  const token = req.headers['x-admin-token'];
  if(token !== ADMIN_TOKEN) return res.status(401).json({ ok:false });

  const id = Number(req.params.id);
  const wd = mockWithdrawals.find(w=>w.id===id);
  if(!wd) return res.json({ ok:false });

  wd.status = 'rejected';
  res.json({ ok:true });
});

// =====================
// Admin trades endpoint
// =====================
app.get("/api/admin/trades", (req, res) => {
  const token = req.headers['x-admin-token'];
  if(token !== ADMIN_TOKEN) return res.status(401).json({ ok:false });

  res.json({ ok:true, items: mockTrades });
});

app.post("/api/admin/trades/:id/close", (req, res) => {
  const token = req.headers['x-admin-token'];
  if(token !== ADMIN_TOKEN) return res.status(401).json({ ok:false });

  const id = Number(req.params.id);
  const trade = mockTrades.find(t=>t.id===id);
  if(!trade) return res.json({ ok:false });

  trade.status = 'closed';
  trade.pnl = req.body.pnl || 0;
  res.json({ ok:true });
});

// =====================
// Serve frontend
// =====================
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "client/index.html"));
});

// =====================
// Start server
// =====================
app.listen(PORT, () => {
  console.log(`✅ QL Admin mock server running on port ${PORT}`);
});
