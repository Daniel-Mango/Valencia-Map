const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Supabase setup
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Serve static files
app.use(express.static('public'));
app.use(express.json());

// No region detection - just track coordinates

// Store tokens in memory (will be replaced by Supabase)
let tokens = [];
let tokenIdCounter = 1;

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  
  // Send current tokens to new player
  socket.emit('tokens:load', tokens);
  
  // Handle token placement
  socket.on('token:place', async (data) => {
    const token = {
      id: tokenIdCounter++,
      x: data.x,
      y: data.y,
      name: data.name || `Token ${tokenIdCounter - 1}`,
      faction: data.faction || '',
      hp: data.hp || 0,
      attack: data.attack || '0',
      counterattack: data.counterattack || '0',
      special: data.special || '',
      notes: data.notes || '',
      color: data.color || '#FF0000',
      playerid: socket.id,
      timestamp: new Date().toISOString()
    };
    
    tokens.push(token);
    
    // Save to Supabase
    try {
      const { data, error } = await supabase.from('tokens').insert([token]);
      if (error) {
        console.log('Supabase insert error:', error);
        console.log('Token data:', JSON.stringify(token, null, 2));
      } else {
        console.log('✅ Token saved to database:', token.name);
      }
    } catch (error) {
      console.log('Supabase exception:', error.message);
      console.log('Token data:', JSON.stringify(token, null, 2));
    }
    
    // Broadcast to all players
    io.emit('token:placed', token);
  });
  
  // Handle token movement
  socket.on('token:move', async (data) => {
    const tokenIndex = tokens.findIndex(t => t.id === data.tokenId);
    if (tokenIndex !== -1) {
      tokens[tokenIndex].x = data.x;
      tokens[tokenIndex].y = data.y;
      
      // Update in Supabase
      try {
        await supabase.from('tokens')
          .update({ x: data.x, y: data.y })
          .eq('id', data.tokenId);
      } catch (error) {
        console.log('Supabase error:', error.message);
      }
      
      // Broadcast to all players
      io.emit('token:moved', {
        tokenId: data.tokenId,
        x: data.x,
        y: data.y
      });
    }
  });
  
  // Handle token removal
  socket.on('token:remove', async (tokenId) => {
    tokens = tokens.filter(t => t.id !== tokenId);
    
    // Remove from Supabase
    try {
      await supabase.from('tokens').delete().eq('id', tokenId);
    } catch (error) {
      console.log('Supabase error:', error.message);
    }
    
    // Broadcast to all players
    io.emit('token:removed', tokenId);
  });
  
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
  });
});

// API endpoints
app.get('/api/tokens', (req, res) => {
  res.json(tokens);
});

// Load tokens from Supabase on startup
async function loadTokensFromDatabase() {
  try {
    const { data, error } = await supabase.from('tokens').select('*');
    if (data && !error) {
      tokens = data;
      tokenIdCounter = tokens.length > 0 ? Math.max(...tokens.map(t => t.id)) + 1 : 1;
      console.log(`Loaded ${tokens.length} tokens from database`);
    }
  } catch (error) {
    console.log('Could not load from Supabase, starting fresh:', error.message);
  }
}

const PORT = process.env.PORT || 3000;

// Initialize and start server
loadTokensFromDatabase().then(() => {
  server.listen(PORT, () => {
    console.log(`D&D Map server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} to view the map`);
  });
});