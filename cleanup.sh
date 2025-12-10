#!/bin/bash

# Create backup
mkdir -p /home/ubuntu/soon_backup
cp -r /home/ubuntu/soon/* /home/ubuntu/soon_backup/

# Remove duplicate controllers in config (server/controllers seems to be the updated one based on diff)
# The diff showed server/controllers/trades.controller.js has more logic (FIXED comments) than server/config/controllers
rm -rf server/config/controllers

# Remove duplicate db.sql in client
rm client/db.sql

# Remove duplicate render.yaml in client
rm client/render.yaml

# Move bot.js to server/bot/ to keep server-side logic together
mkdir -p server/bot
mv bot/bot.js server/bot/
rmdir bot

# Move client-side files to public folder if they are static assets
# But first let's check if client/index.js is actually a server file or client file
# Based on file list, client/index.js exists. Let's assume it's client-side logic.
# We will keep client folder as is for now but clean up the root level clutter later.

echo "Cleanup completed."
