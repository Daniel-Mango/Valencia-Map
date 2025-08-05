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

// Store faction stats in memory (will be synced with Supabase)
let factionStats = [];
let factionStatsIdCounter = 1;

// Store move proposals in memory (will be synced with Supabase)
let moveProposals = [];
let movableFactionsConfig = [];

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  
  // Store user role on socket
  socket.userRole = null;
  socket.isAuthenticated = false;
  
  // Handle authentication
  socket.on('authenticate', (data) => {
    const { password, role } = data;
    
    if (role === 'dm') {
      if (password === process.env.DM_PASSWORD) {
        socket.userRole = 'dm';
        socket.isAuthenticated = true;
        socket.emit('auth_result', { success: true, role: 'dm' });
        console.log('DM authenticated:', socket.id);
      } else {
        socket.emit('auth_result', { success: false, message: 'Invalid DM password' });
        console.log('Failed DM authentication:', socket.id);
      }
    } else if (role === 'player') {
      socket.userRole = 'player';
      socket.isAuthenticated = true;
      socket.emit('auth_result', { success: true, role: 'player' });
      console.log('Player authenticated:', socket.id);
    } else {
      socket.emit('auth_result', { success: false, message: 'Invalid role' });
    }
  });
  
  // Set role (called after authentication)
  socket.on('set_role', (data) => {
    if (socket.isAuthenticated) {
      socket.userRole = data.role;
      console.log('Role set for', socket.id, ':', data.role);
      
      // Send current tokens to authenticated user (filtered for players)
      const tokensToSend = socket.userRole === 'dm' ? tokens : tokens.filter(t => t.visible_to_players !== false);
      console.log(`Initial load: Sending ${tokensToSend.length}/${tokens.length} tokens to ${socket.userRole} ${socket.id}`);
      socket.emit('tokens:load', tokensToSend);
      
      // Send faction stats to authenticated user (filtered for players)
      const factionStatsToSend = socket.userRole === 'dm' ? factionStats : factionStats.filter(f => f.is_visible === true);
      console.log(`Initial load: Sending ${factionStatsToSend.length}/${factionStats.length} faction stats to ${socket.userRole} ${socket.id}`);
      socket.emit('faction_stats:load', factionStatsToSend);
      
      // Send move proposals and movable factions config
      socket.emit('move_proposals:load', moveProposals);
      socket.emit('movable_factions:load', movableFactionsConfig);
    }
  });
  
  // Helper function to check if user is DM
  function isDM(socket) {
    return socket.isAuthenticated && socket.userRole === 'dm';
  }
  
  // Helper function to check if user is authenticated
  function isAuthenticated(socket) {
    return socket.isAuthenticated;
  }

  // Handle token refresh requests
  socket.on('request_tokens', () => {
    if (socket.isAuthenticated) {
      const tokensToSend = socket.userRole === 'dm' ? tokens : tokens.filter(t => t.visible_to_players !== false);
      console.log(`Sending ${tokensToSend.length}/${tokens.length} tokens to ${socket.userRole} ${socket.id}`);
      socket.emit('tokens:load', tokensToSend);
      
      // Also send faction stats
      const factionStatsToSend = socket.userRole === 'dm' ? factionStats : factionStats.filter(f => f.is_visible === true);
      socket.emit('faction_stats:load', factionStatsToSend);
    }
  });
  
  // Handle token placement (DM only)
  socket.on('token:place', async (data) => {
    if (!isDM(socket)) {
      socket.emit('error', { message: 'Only DM can place tokens' });
      return;
    }
    const token = {
      id: tokenIdCounter++,
      x: data.x,
      y: data.y,
      name: data.name || `Token ${tokenIdCounter - 1}`,
      faction: data.faction || '',
      hp: data.hp || 0,
      max_hp: data.max_hp || data.hp || 0,
      current_hp: data.current_hp || data.hp || 0,
      attack: data.attack || '0',
      counterattack: data.counterattack || '0',
      special: data.special || '',
      notes: data.notes || '',
      color: data.color || '#FF0000',
      playerid: socket.id,
      visible_to_players: data.visible_to_players !== false, // Default to true
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
    
    // Broadcast to all players (filter for player clients)
    io.sockets.sockets.forEach((clientSocket) => {
      if (clientSocket.isAuthenticated) {
        if (clientSocket.userRole === 'dm' || token.visible_to_players !== false) {
          clientSocket.emit('token:placed', token);
        }
      }
    });
  });
  
  // Handle token movement (DM only for now)
  socket.on('token:move', async (data) => {
    if (!isDM(socket)) {
      socket.emit('error', { message: 'Only DM can move tokens' });
      return;
    }
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
      
      // Broadcast to all players (filter for player clients)
      const updatedToken = tokens[tokenIndex];
      io.sockets.sockets.forEach((clientSocket) => {
        if (clientSocket.isAuthenticated) {
          if (clientSocket.userRole === 'dm' || updatedToken.visible_to_players !== false) {
            clientSocket.emit('token:moved', {
              tokenId: data.tokenId,
              x: data.x,
              y: data.y
            });
          }
        }
      });
    }
  });

  // Handle token updates (DM only)
  socket.on('token:update', async (updatedData) => {
    if (!isDM(socket)) {
      socket.emit('error', { message: 'Only DM can update tokens' });
      return;
    }
    
    const tokenIndex = tokens.findIndex(t => t.id === updatedData.id);
    if (tokenIndex !== -1) {
      // Update local token
      tokens[tokenIndex] = { ...tokens[tokenIndex], ...updatedData };
      
      // Update in Supabase
      try {
        const { data, error } = await supabase.from('tokens')
          .update({
            name: updatedData.name,
            faction: updatedData.faction,
            current_hp: updatedData.current_hp,
            max_hp: updatedData.max_hp,
            attack: updatedData.attack,
            counterattack: updatedData.counterattack,
            special: updatedData.special,
            notes: updatedData.notes,
            color: updatedData.color,
            visible_to_players: updatedData.visible_to_players
          })
          .eq('id', updatedData.id);
          
        if (error) {
          console.log('Supabase update error:', error);
        } else {
          console.log('✅ Token updated in database:', updatedData.name);
        }
      } catch (error) {
        console.log('Supabase update exception:', error.message);
      }
      
      // Broadcast to all players (filter for player clients)
      const updatedToken = tokens[tokenIndex];
      io.sockets.sockets.forEach((clientSocket) => {
        if (clientSocket.isAuthenticated) {
          if (clientSocket.userRole === 'dm') {
            // DM always sees all tokens
            clientSocket.emit('token:updated', updatedToken);
          } else if (clientSocket.userRole === 'player') {
            if (updatedToken.visible_to_players !== false) {
              // Token is visible to players - send update or placement
              clientSocket.emit('token:updated', updatedToken);
            } else {
              // Token became invisible to players - remove it from their view
              clientSocket.emit('token:removed', updatedToken.id);
            }
          }
        }
      });
    }
  });
  
  // Handle token removal (DM only)
  socket.on('token:remove', async (tokenId) => {
    if (!isDM(socket)) {
      socket.emit('error', { message: 'Only DM can remove tokens' });
      return;
    }
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

  // Handle faction stats creation/update (DM only)
  socket.on('faction_stats:update', async (factionData) => {
    console.log('📊 Faction stats update request received from', socket.id);
    console.log('📊 User role:', socket.userRole, 'Is DM:', isDM(socket));
    console.log('📊 Faction data received:', JSON.stringify(factionData, null, 2));
    
    if (!isDM(socket)) {
      console.log('❌ Non-DM user attempted to update faction stats');
      socket.emit('error', { message: 'Only DM can update faction stats' });
      return;
    }

    try {
      let updatedFaction;
      const existingIndex = factionStats.findIndex(f => f.faction_name === factionData.faction_name);

      if (existingIndex !== -1) {
        // Update existing faction
        console.log('📊 Updating existing faction at index:', existingIndex);
        factionStats[existingIndex] = { ...factionStats[existingIndex], ...factionData };
        updatedFaction = factionStats[existingIndex];
        console.log('📊 Updated faction in memory:', JSON.stringify(updatedFaction, null, 2));

        // Update in Supabase
        console.log('📊 Updating faction in Supabase database...');
        const { data, error } = await supabase.from('faction_stats')
          .update({
            current_hp: factionData.current_hp,
            max_hp: factionData.max_hp,
            force_stat: factionData.force_stat,
            wealth_stat: factionData.wealth_stat,
            cunning_stat: factionData.cunning_stat,
            magic_stat: factionData.magic_stat,
            treasure_stat: factionData.treasure_stat,
            is_visible: factionData.is_visible
          })
          .eq('faction_name', factionData.faction_name)
          .select()
          .single();

        if (error) {
          console.log('❌ Supabase faction update error:', JSON.stringify(error, null, 2));
        } else {
          console.log('✅ Faction stats updated in database:', factionData.faction_name);
          console.log('📊 Database response:', JSON.stringify(data, null, 2));
        }
      } else {
        // Create new faction
        console.log('📊 Creating new faction (not found in memory)');
        const newFaction = {
          id: factionStatsIdCounter++,
          faction_name: factionData.faction_name,
          current_hp: factionData.current_hp || 0,
          max_hp: factionData.max_hp || 0,
          force_stat: factionData.force_stat || 0,
          wealth_stat: factionData.wealth_stat || 0,
          cunning_stat: factionData.cunning_stat || 0,
          magic_stat: factionData.magic_stat || 'None',
          treasure_stat: factionData.treasure_stat || 0,
          is_visible: factionData.is_visible || false
        };

        console.log('📊 New faction object:', JSON.stringify(newFaction, null, 2));
        factionStats.push(newFaction);
        updatedFaction = newFaction;
        console.log('📊 Faction added to memory. Total factions:', factionStats.length);

        // Insert into Supabase
        console.log('📊 Inserting new faction into Supabase database...');
        const { data, error } = await supabase.from('faction_stats')
          .insert([newFaction])
          .select()
          .single();

        if (error) {
          console.log('❌ Supabase faction insert error:', JSON.stringify(error, null, 2));
        } else {
          console.log('✅ New faction stats saved to database:', factionData.faction_name);
          console.log('📊 Database response:', JSON.stringify(data, null, 2));
        }
      }

      // Broadcast to all players (filter for player clients)
      console.log('📊 Broadcasting faction update to all clients...');
      let dmClients = 0, playerClients = 0, visibleToPlayers = 0;
      
      io.sockets.sockets.forEach((clientSocket) => {
        if (clientSocket.isAuthenticated) {
          if (clientSocket.userRole === 'dm') {
            // DM always sees all factions
            clientSocket.emit('faction_stats:updated', updatedFaction);
            dmClients++;
            console.log(`📊 Sent faction update to DM client: ${clientSocket.id}`);
          } else if (clientSocket.userRole === 'player' && updatedFaction.is_visible) {
            // Players only see visible factions
            clientSocket.emit('faction_stats:updated', updatedFaction);
            playerClients++;
            visibleToPlayers++;
            console.log(`📊 Sent faction update to player client: ${clientSocket.id}`);
          } else if (clientSocket.userRole === 'player') {
            playerClients++;
            console.log(`📊 Faction not visible to player client: ${clientSocket.id}`);
          }
        }
      });
      
      console.log(`📊 Broadcast summary - DM clients: ${dmClients}, Player clients: ${playerClients}, Visible to players: ${visibleToPlayers}`);

    } catch (error) {
      console.log('Faction stats update exception:', error.message);
      socket.emit('error', { message: 'Failed to update faction stats' });
    }
  });

  // Handle faction stats deletion (DM only)
  socket.on('faction_stats:delete', async (factionName) => {
    if (!isDM(socket)) {
      socket.emit('error', { message: 'Only DM can delete faction stats' });
      return;
    }

    try {
      // Remove from memory
      factionStats = factionStats.filter(f => f.faction_name !== factionName);

      // Remove from Supabase
      await supabase.from('faction_stats').delete().eq('faction_name', factionName);
      console.log('✅ Faction stats deleted:', factionName);

      // Broadcast to all players
      io.emit('faction_stats:deleted', factionName);

    } catch (error) {
      console.log('Faction stats delete exception:', error.message);
      socket.emit('error', { message: 'Failed to delete faction stats' });
    }
  });

  // Handle move proposal creation (Player only)
  socket.on('move_proposal:create', async (proposalData) => {
    console.log('🎯 Move proposal request received from', socket.id);
    console.log('🎯 User role:', socket.userRole);
    console.log('🎯 Proposal data:', JSON.stringify(proposalData, null, 2));
    
    if (socket.userRole !== 'player') {
      console.log('❌ Non-player user attempted to create move proposal');
      socket.emit('error', { message: 'Only players can create move proposals' });
      return;
    }

    try {
      // Remove any existing proposal for this token
      await supabase.from('move_proposals').delete().eq('token_id', proposalData.token_id);
      moveProposals = moveProposals.filter(p => p.token_id !== proposalData.token_id);

      const newProposal = {
        token_id: proposalData.token_id,
        original_x: proposalData.original_x,
        original_y: proposalData.original_y,
        proposed_x: proposalData.proposed_x,
        proposed_y: proposalData.proposed_y,
        proposed_by_session: socket.id
      };

      // Insert into Supabase
      const { data, error } = await supabase.from('move_proposals')
        .insert([newProposal])
        .select()
        .single();

      if (error) {
        console.log('❌ Supabase move proposal insert error:', JSON.stringify(error, null, 2));
        socket.emit('error', { message: 'Failed to create move proposal' });
        return;
      }

      console.log('✅ Move proposal created:', JSON.stringify(data, null, 2));
      moveProposals.push(data);

      // Broadcast to all clients
      io.emit('move_proposal:created', data);

    } catch (error) {
      console.log('❌ Move proposal creation exception:', error.message);
      socket.emit('error', { message: 'Failed to create move proposal' });
    }
  });

  // Handle move proposal update (Player only - for dragging ghosts)
  socket.on('move_proposal:update', async (proposalData) => {
    console.log('🎯 Move proposal update request from', socket.id);
    console.log('🎯 Update data:', JSON.stringify(proposalData, null, 2));
    
    if (socket.userRole !== 'player') {
      console.log('❌ Non-player user attempted to update move proposal');
      socket.emit('error', { message: 'Only players can update move proposals' });
      return;
    }

    try {
      // Find existing proposal for this token
      const existingProposalIndex = moveProposals.findIndex(p => p.token_id === proposalData.token_id);
      
      if (existingProposalIndex !== -1) {
        // Update existing proposal
        moveProposals[existingProposalIndex].proposed_x = proposalData.proposed_x;
        moveProposals[existingProposalIndex].proposed_y = proposalData.proposed_y;
        
        // Update in database
        await supabase.from('move_proposals')
          .update({ 
            proposed_x: proposalData.proposed_x, 
            proposed_y: proposalData.proposed_y 
          })
          .eq('token_id', proposalData.token_id);
        
        // Broadcast updated proposal
        io.emit('move_proposal:updated', moveProposals[existingProposalIndex]);
        console.log('✅ Move proposal updated:', proposalData.token_id);
      } else {
        console.log('❌ No existing proposal found for token:', proposalData.token_id);
        socket.emit('error', { message: 'No existing proposal found' });
      }

    } catch (error) {
      console.log('❌ Move proposal update exception:', error.message);
      socket.emit('error', { message: 'Failed to update move proposal' });
    }
  });

  // Handle move proposal approval (DM only)
  socket.on('move_proposal:approve', async (proposalId) => {
    console.log('🎯 Move proposal approval request from', socket.id, 'for proposal', proposalId);
    
    if (!isDM(socket)) {
      socket.emit('error', { message: 'Only DM can approve move proposals' });
      return;
    }

    try {
      const proposal = moveProposals.find(p => p.id === proposalId);
      if (!proposal) {
        socket.emit('error', { message: 'Proposal not found' });
        return;
      }

      // Move the actual token
      const tokenIndex = tokens.findIndex(t => t.id === proposal.token_id);
      if (tokenIndex !== -1) {
        tokens[tokenIndex].x = proposal.proposed_x;
        tokens[tokenIndex].y = proposal.proposed_y;
        
        // Update in Supabase
        await supabase.from('tokens')
          .update({ x: proposal.proposed_x, y: proposal.proposed_y })
          .eq('id', proposal.token_id);

        // Broadcast token movement
        const updatedToken = tokens[tokenIndex];
        io.sockets.sockets.forEach((clientSocket) => {
          if (clientSocket.isAuthenticated) {
            if (clientSocket.userRole === 'dm' || updatedToken.visible_to_players !== false) {
              clientSocket.emit('token:moved', {
                tokenId: proposal.token_id,
                x: proposal.proposed_x,
                y: proposal.proposed_y
              });
            }
          }
        });
      }

      // Remove the proposal
      await supabase.from('move_proposals').delete().eq('id', proposalId);
      moveProposals = moveProposals.filter(p => p.id !== proposalId);

      // Broadcast proposal removal
      io.emit('move_proposal:approved', proposalId);
      console.log('✅ Move proposal approved and executed:', proposalId);

    } catch (error) {
      console.log('❌ Move proposal approval exception:', error.message);
      socket.emit('error', { message: 'Failed to approve move proposal' });
    }
  });

  // Handle move proposal rejection (DM only)
  socket.on('move_proposal:reject', async (proposalId) => {
    console.log('🎯 Move proposal rejection request from', socket.id, 'for proposal', proposalId);
    
    if (!isDM(socket)) {
      socket.emit('error', { message: 'Only DM can reject move proposals' });
      return;
    }

    try {
      // Remove the proposal
      await supabase.from('move_proposals').delete().eq('id', proposalId);
      moveProposals = moveProposals.filter(p => p.id !== proposalId);

      // Broadcast proposal removal
      io.emit('move_proposal:rejected', proposalId);
      console.log('✅ Move proposal rejected:', proposalId);

    } catch (error) {
      console.log('❌ Move proposal rejection exception:', error.message);
      socket.emit('error', { message: 'Failed to reject move proposal' });
    }
  });

  // Handle move proposal cancellation (Player only - for their own proposals)
  socket.on('move_proposal:cancel', async (proposalId) => {
    console.log('🎯 Move proposal cancellation request from', socket.id, 'for proposal', proposalId);
    
    if (socket.userRole !== 'player') {
      socket.emit('error', { message: 'Only players can cancel move proposals' });
      return;
    }

    try {
      // Remove the proposal
      await supabase.from('move_proposals').delete().eq('id', proposalId);
      moveProposals = moveProposals.filter(p => p.id !== proposalId);

      // Broadcast proposal removal
      io.emit('move_proposal:rejected', proposalId);
      console.log('✅ Move proposal cancelled by player:', proposalId);

    } catch (error) {
      console.log('❌ Move proposal cancellation exception:', error.message);
      socket.emit('error', { message: 'Failed to cancel move proposal' });
    }
  });

  // Handle clearing all move proposals (DM only)  
  socket.on('move_proposals:clear_all', async () => {
    console.log('🎯 Clear all proposals request from', socket.id);
    
    if (!isDM(socket)) {
      socket.emit('error', { message: 'Only DM can clear all proposals' });
      return;
    }

    try {
      // Remove all proposals from database
      await supabase.from('move_proposals').delete().neq('id', 0); // Delete all
      moveProposals = [];

      // Broadcast to all clients
      io.emit('move_proposals:cleared');
      console.log('✅ All move proposals cleared');

    } catch (error) {
      console.log('❌ Clear all proposals exception:', error.message);
      socket.emit('error', { message: 'Failed to clear all proposals' });
    }
  });

  // Handle movable factions configuration (DM only)
  socket.on('movable_factions:update', async (factionsConfig) => {
    console.log('🎯 Movable factions update from', socket.id);
    console.log('🎯 Factions config:', JSON.stringify(factionsConfig, null, 2));
    
    if (!isDM(socket)) {
      socket.emit('error', { message: 'Only DM can configure movable factions' });
      return;
    }

    try {
      // Clear existing config
      await supabase.from('movable_factions').delete().neq('id', 0);
      
      // Insert new config
      if (factionsConfig.length > 0) {
        await supabase.from('movable_factions').insert(factionsConfig);
      }

      movableFactionsConfig = factionsConfig;

      // Broadcast to all clients
      io.emit('movable_factions:updated', factionsConfig);
      console.log('✅ Movable factions configuration updated');

    } catch (error) {
      console.log('❌ Movable factions update exception:', error.message);
      socket.emit('error', { message: 'Failed to update movable factions' });
    }
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
      // Ensure all tokens have proper visibility defaults
      tokens = data.map(token => ({
        ...token,
        visible_to_players: token.visible_to_players !== false, // Convert null/undefined to true
        max_hp: token.max_hp || token.hp || 0,
        current_hp: token.current_hp !== null ? token.current_hp : (token.hp || 0)
      }));
      tokenIdCounter = tokens.length > 0 ? Math.max(...tokens.map(t => t.id)) + 1 : 1;
      console.log(`Loaded ${tokens.length} tokens from database`);
      console.log('Token visibility states:', tokens.map(t => ({ name: t.name, visible: t.visible_to_players })));
    }
  } catch (error) {
    console.log('Could not load from Supabase, starting fresh:', error.message);
  }
}

// Load faction stats from Supabase on startup
async function loadFactionStatsFromDatabase() {
  try {
    console.log('📊 Loading faction stats from Supabase database...');
    const { data, error } = await supabase.from('faction_stats').select('*');
    
    console.log('📊 Supabase response - Data:', data);
    console.log('📊 Supabase response - Error:', error);
    
    if (data && !error) {
      factionStats = data.map(faction => ({
        ...faction,
        is_visible: faction.is_visible === true // Ensure boolean conversion
      }));
      factionStatsIdCounter = factionStats.length > 0 ? Math.max(...factionStats.map(f => f.id)) + 1 : 1;
      console.log(`✅ Loaded ${factionStats.length} faction stats from database`);
      console.log('📊 Loaded faction stats:', JSON.stringify(factionStats, null, 2));
      console.log('📊 Faction visibility states:', factionStats.map(f => ({ name: f.faction_name, visible: f.is_visible })));
      console.log('📊 Next faction ID will be:', factionStatsIdCounter);
    } else {
      console.log('📊 No faction stats data returned or error occurred');
    }
  } catch (error) {
    console.log('❌ Could not load faction stats from Supabase, starting fresh:', error.message);
    console.log('❌ Full error:', JSON.stringify(error, null, 2));
  }
}

const PORT = process.env.PORT || 3000;

// Load move proposals from Supabase on startup
async function loadMoveProposalsFromDatabase() {
  try {
    console.log('🎯 Loading move proposals from Supabase database...');
    const { data, error } = await supabase.from('move_proposals').select('*');
    
    if (data && !error) {
      moveProposals = data;
      console.log(`✅ Loaded ${moveProposals.length} move proposals from database`);
      console.log('🎯 Move proposals:', JSON.stringify(moveProposals, null, 2));
    } else {
      console.log('🎯 No move proposals data returned or error occurred');
    }
  } catch (error) {
    console.log('❌ Could not load move proposals from Supabase:', error.message);
  }
}

// Load movable factions configuration from Supabase on startup
async function loadMovableFactionsFromDatabase() {
  try {
    console.log('🎯 Loading movable factions config from Supabase database...');
    const { data, error } = await supabase.from('movable_factions').select('*');
    
    if (data && !error) {
      movableFactionsConfig = data;
      console.log(`✅ Loaded ${movableFactionsConfig.length} movable factions from database`);
      console.log('🎯 Movable factions config:', JSON.stringify(movableFactionsConfig, null, 2));
    } else {
      console.log('🎯 No movable factions config returned or error occurred');
    }
  } catch (error) {
    console.log('❌ Could not load movable factions from Supabase:', error.message);
  }
}

// Function to insert test faction data
async function insertTestFactionData() {
  console.log('📊 Inserting test faction data...');
  
  const testFactions = [
    {
      faction_name: 'The Iron Legion',
      current_hp: 85,
      max_hp: 100,
      force_stat: 8,
      wealth_stat: 4,
      cunning_stat: 3,
      magic_stat: 'Low',
      treasure_stat: 6,
      is_visible: true
    },
    {
      faction_name: 'Shadowmere Guild',
      current_hp: 60,
      max_hp: 80,
      force_stat: 5,
      wealth_stat: 9,
      cunning_stat: 8,
      magic_stat: 'High',
      treasure_stat: 8,
      is_visible: true
    },
    {
      faction_name: 'Crystal Order',
      current_hp: 95,
      max_hp: 100,
      force_stat: 3,
      wealth_stat: 6,
      cunning_stat: 5,
      magic_stat: 'Very High',
      treasure_stat: 4,
      is_visible: false
    },
    {
      faction_name: 'Crimson Mercenaries',
      current_hp: 40,
      max_hp: 75,
      force_stat: 7,
      wealth_stat: 5,
      cunning_stat: 6,
      magic_stat: 'None',
      treasure_stat: 3,
      is_visible: true
    }
  ];

  try {
    for (const faction of testFactions) {
      console.log(`📊 Inserting test faction: ${faction.faction_name}`);
      
      const { data, error } = await supabase
        .from('faction_stats')
        .insert([faction])
        .select()
        .single();

      if (error) {
        console.log(`❌ Failed to insert ${faction.faction_name}:`, JSON.stringify(error, null, 2));
      } else {
        console.log(`✅ Successfully inserted ${faction.faction_name}:`, JSON.stringify(data, null, 2));
        
        // Add to memory array too
        factionStats.push({
          ...data,
          is_visible: data.is_visible === true
        });
      }
    }
    
    console.log(`📊 Test data insertion complete. Total factions in memory: ${factionStats.length}`);
    
    // Update the ID counter
    if (factionStats.length > 0) {
      factionStatsIdCounter = Math.max(...factionStats.map(f => f.id)) + 1;
      console.log(`📊 Updated faction ID counter to: ${factionStatsIdCounter}`);
    }
    
  } catch (error) {
    console.log('❌ Error during test faction data insertion:', error.message);
    console.log('❌ Full error:', JSON.stringify(error, null, 2));
  }
}

// Initialize and start server
Promise.all([
  loadTokensFromDatabase(),
  loadFactionStatsFromDatabase(),
  loadMoveProposalsFromDatabase(),
  loadMovableFactionsFromDatabase()
]).then(async () => {
  // Uncomment the line below to insert test data on server startup
  // await insertTestFactionData();
  
  server.listen(PORT, () => {
    console.log(`D&D Map server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} to view the map`);
    console.log('💡 To insert test faction data, uncomment the insertTestFactionData() line in server.js');
  });
});