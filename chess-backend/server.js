const express = require('express');
const cors = require('cors');
const http = require('http');
const socketio = require('socket.io');
const connectDB = require('./config/db');
const Match = require('./models/Match');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

const io = socketio(server, {
  cors: {
    origin: CLIENT_URL,
    methods: ['GET', 'POST']
  }
});

connectDB();
app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());
app.get('/', (req, res) => res.send('API & Socket Server Running!'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/room', require('./routes/room'));
app.use('/api/match', require('./routes/match'));

const rooms = {};
const matchmakingQueue = {};

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getTimeControlKey(timeControl) {
  if (!timeControl || typeof timeControl.time === 'undefined' || typeof timeControl.increment === 'undefined') {
      return 'Any_0_0';
  }
  return `${timeControl.categoryName || 'Any'}_${timeControl.time}_${timeControl.increment}`;
}

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('joinRoom', ({ roomId, userId: clientUserId }) => {
    if (!roomId || !clientUserId) {
      console.error(`joinRoom: Missing roomId or clientUserId from socket ${socket.id}`);
      return;
    }
    socket.join(roomId);
    if (!rooms[roomId]) {
      rooms[roomId] = { players: [], game: null, playerDetails: {}, moveHistory: [] };
    }
    const room = rooms[roomId];
    const existingPlayer = room.players.find(p => p.userId === clientUserId);
    if (existingPlayer && existingPlayer.socketId !== socket.id) {
      socket.emit('errorJoining', { message: 'User ID already in room with another connection.' });
      return;
    }
    if (!existingPlayer) {
        if (room.players.length < 2) {
            room.players.push({ socketId: socket.id, userId: clientUserId, ready: false, username: socket.handshake.query.username || `User-${clientUserId.substring(0,5)}` });
        } else {
            socket.emit('roomFull', { message: 'Room is full.' });
            return;
        }
    }
    console.log(`User ${clientUserId} (socket ${socket.id}) processed for manual join to room ${roomId}. Players: ${room.players.length}`);
  });

  socket.on('clientReadyForGame', ({ roomId, userId: clientUserId }) => {
    if (!roomId || !clientUserId ) {
        console.error(`clientReadyForGame: Missing roomId or userId for socket ${socket.id}`);
        return;
    }
    console.log(`Received 'clientReadyForGame' from UserID: ${clientUserId}, SocketID: ${socket.id} for RoomID: ${roomId}`);
    if (!rooms[roomId] || !rooms[roomId].players) {
        console.warn(`clientReadyForGame: Room ${roomId} or players list not found for socket ${socket.id}.`);
        return;
    }
    const room = rooms[roomId];
    const player = room.players.find(p => p.socketId === socket.id && p.userId === clientUserId);
    if (player) {
      player.ready = true;
      player.username = socket.handshake.query.username || player.username || `User-${clientUserId.substring(0,5)}`; // Cập nhật username
      console.log(`User ${clientUserId} (socket ${socket.id}) in room ${roomId} marked as READY. Player object:`, JSON.stringify(player));
      console.log(`All players in room ${roomId} after this ready signal:`, JSON.stringify(room.players.map(p => ({userId: p.userId, username: p.username, ready: p.ready}))));
      checkAndStartOrResendGame(roomId, io);
    } else {
        console.error(`Player not found for clientReadyForGame: socket ${socket.id}, user ${clientUserId}, in room ${roomId}.`);
        console.error(`Current players in room ${roomId}:`, JSON.stringify(room.players));
    }
  });

  socket.on('findMatch', ({ userId, timeControl, username }) => {
    if (!userId || !timeControl) {
      socket.emit('matchmakingError', { message: 'User ID or Time Control missing.' });
      return;
    }
    console.log(`User ${userId} (Socket: ${socket.id}, Username: ${username}) looking for match with time control:`, timeControl);

    const timeKey = getTimeControlKey(timeControl);
    if (!matchmakingQueue[timeKey]) {
      matchmakingQueue[timeKey] = [];
    }

    const alreadyInQueue = matchmakingQueue[timeKey].find(p => p.userId === userId);
    if (alreadyInQueue) {
        if (alreadyInQueue.socketId !== socket.id)  alreadyInQueue.socketId = socket.id;
        alreadyInQueue.username = username || alreadyInQueue.username; // Cập nhật username nếu có
        console.log(`User ${userId} already in queue for ${timeKey}.`);
        socket.emit('addedToQueue', { message: `You are already in queue for ${timeControl.label}.`});
        return;
    }

    const opponentFound = matchmakingQueue[timeKey].find(p => p.userId !== userId);

    if (opponentFound) {
      const player1 = { userId, socketId: socket.id, timeControlDetails: timeControl, username: username || `User-${userId.substring(0,5)}` };
      const player2 = opponentFound;

      matchmakingQueue[timeKey] = matchmakingQueue[timeKey].filter(p => p.userId !== player2.userId);
      if (matchmakingQueue[timeKey].length === 0) delete matchmakingQueue[timeKey];

      const newRoomId = generateRoomId();
      console.log(`Match found for ${timeKey}! Room: ${newRoomId}. Players: ${player1.username} vs ${player2.username}`);

      rooms[newRoomId] = { players: [], game: null, playerDetails: {}, moveHistory: [], timeControl };
      
      rooms[newRoomId].players.push({ socketId: player1.socketId, userId: player1.userId, ready: false, username: player1.username });
      rooms[newRoomId].players.push({ socketId: player2.socketId, userId: player2.userId, ready: false, username: player2.username });

      io.sockets.sockets.get(player1.socketId)?.join(newRoomId);
      io.sockets.sockets.get(player2.socketId)?.join(newRoomId);
      
      console.log(`Emitting 'matchFound' to ${player1.username} (${player1.socketId}) and ${player2.username} (${player2.socketId}) for room ${newRoomId}`);
      io.to(player1.socketId).emit('matchFound', { roomId: newRoomId, opponent: {userId: player2.userId, username: player2.username}, timeControl });
      io.to(player2.socketId).emit('matchFound', { roomId: newRoomId, opponent: {userId: player1.userId, username: player1.username}, timeControl });
    } else {
      matchmakingQueue[timeKey].push({ userId, socketId: socket.id, timeControlDetails: timeControl, username: username || `User-${userId.substring(0,5)}` });
      console.log(`User ${userId} (${username}) added to queue for ${timeKey}. Queue length: ${matchmakingQueue[timeKey].length}`);
      socket.emit('addedToQueue', { message: `Added to queue for ${timeControl.label}. Waiting for opponent...` });
    }
  });

  socket.on('cancelFindMatch', ({ userId }) => {
    if (!userId) return;
    let foundAndRemoved = false;
    for (const timeKey in matchmakingQueue) {
      const playerIndex = matchmakingQueue[timeKey].findIndex(p => p.userId === userId && p.socketId === socket.id);
      if (playerIndex !== -1) {
        matchmakingQueue[timeKey].splice(playerIndex, 1);
        if (matchmakingQueue[timeKey].length === 0) delete matchmakingQueue[timeKey];
        console.log(`User ${userId} (Socket: ${socket.id}) removed from queue for ${timeKey}.`);
        socket.emit('matchmakingCancelledFeedback', { message: 'Search cancelled.' });
        foundAndRemoved = true;
        break;
      }
    }
    if (!foundAndRemoved) console.log(`User ${userId} (Socket: ${socket.id}) requested cancel but not found in any active queue.`);
  });
  
  socket.on('move', ({ roomId, move, fen, playerColorMakingMove }) => {
    const room = rooms[roomId];
    if (!room || !room.game || !room.playerDetails.white || !room.playerDetails.black) {
        console.log(`Move received for invalid room/game: ${roomId}`);
        socket.emit('errorMove', {message: "Game not found or not initialized"});
        return;
    }
    
    const playerSocketEntry = room.players.find(p => p.socketId === socket.id);
    if (!playerSocketEntry) {
        console.log(`Move from unknown socket ${socket.id} in room ${roomId}`);
        socket.emit('errorMove', {message: "Unauthorized move attempt"});
        return;
    }

    const actualPlayerColor = room.playerDetails.white === playerSocketEntry.userId ? 'w' : 
                        room.playerDetails.black === playerSocketEntry.userId ? 'b' : null;

    if (actualPlayerColor !== playerColorMakingMove) {
        console.log(`Color mismatch for move in room ${roomId}. Expected ${actualPlayerColor}, client sent ${playerColorMakingMove}. Player UserID: ${playerSocketEntry.userId}`);
        socket.emit('invalidMove', { message: 'Color mismatch.' });
        return;
    }

    if (room.game.turn !== actualPlayerColor) {
      console.log(`Invalid turn in room ${roomId}. Server expected ${room.game.turn}, but ${actualPlayerColor} (UserID: ${playerSocketEntry.userId}) moved.`);
      socket.emit('invalidMove', { message: 'Not your turn!' });
      return;
    }
    
    room.game.fen = fen;
    const serverCalculatedNextTurn = actualPlayerColor === 'w' ? 'b' : 'w';
    room.game.turn = serverCalculatedNextTurn; 
    
    const moverUserId = playerSocketEntry.userId;
    const moverUsername = playerSocketEntry.username;
    
    if (!room.moveHistory) room.moveHistory = [];
    room.moveHistory.push({ player: moverUsername, move: move.san, color: actualPlayerColor, userId: moverUserId });

    const opponent = room.players.find(p => p.socketId !== socket.id);
    if (opponent) {
      io.to(opponent.socketId).emit('receiveMove', { 
          roomId: roomId, move, fen: room.game.fen, 
          nextTurn: room.game.turn, 
          opponentColor: actualPlayerColor,
          playerName: moverUsername, 
          userIdOfMover: moverUserId
        });
    }
    console.log(`Move in room ${roomId} by ${actualPlayerColor} (${moverUserId}-${moverUsername}). New FEN: ${fen}. Server next turn IS NOW: ${room.game.turn}`);
  });

  socket.on('chatMessage', ({ roomId, userId, senderName, text, time }) => {
    if (!roomId) return;
    io.to(roomId).emit('chatMessage', { roomId, userId, senderName, text, time });
  });
  
  socket.on('gameIsOver', async ({ roomId, result, fen, reason }) => {
    const room = rooms[roomId];
    if (!room || !room.playerDetails.white || !room.playerDetails.black) return;
    console.log(`Game in room ${roomId} reported over by client. Result: ${result}. Reason: ${reason}. Final FEN: ${fen}`);
    const endMessage = reason ? `${reason} (Result: ${result})` : `Game over. Result: ${result}`;
    io.to(roomId).emit('gameEndedByServer', { roomId, result, message: endMessage, finalFen: fen });
    try {
      await Match.create({
        roomId, whitePlayerId: room.playerDetails.white, blackPlayerId: room.playerDetails.black,
        result: result, playedAt: new Date(), finalFen: fen, moveHistory: room.moveHistory || []
      });
      console.log('Match result saved to MongoDB for room:', roomId);
    } catch (err) { console.error('Error saving match to MongoDB:', err); }
    room.game = null; // Game ended, reset
    room.players.forEach(p => p.ready = false); // Players not ready for a new game until they explicitly say so
  });

  socket.on('resignGame', async ({ roomId, resigningUserId, resigningPlayerColor }) => {
    const room = rooms[roomId];
    if (!room || !room.game || room.players.length !== 2 || !room.playerDetails.white || !room.playerDetails.black) return;
    const playerResigning = room.players.find(p => p.userId === resigningUserId && p.socketId === socket.id);
    if (!playerResigning) return;
    const winnerUserId = room.players.find(p => p.userId !== resigningUserId)?.userId;
    if (!winnerUserId) return;
    let result = ''; let finalMessage = '';
    const langForMessage = 'en'; 
    if (room.playerDetails.white === winnerUserId) { result = '1-0'; finalMessage = `White wins as Black resigned.`;} 
    else { result = '0-1'; finalMessage = `Black wins as White resigned.`;}
    console.log(`User ${resigningUserId} resigned in room ${roomId}. ${winnerUserId} wins.`);
    io.to(roomId).emit('gameEndedByServer', { roomId, result, message: finalMessage, finalFen: room.game.fen });
    try {
      await Match.create({
        roomId, whitePlayerId: room.playerDetails.white, blackPlayerId: room.playerDetails.black,
        result: result, playedAt: new Date(), finalFen: room.game.fen, notes: `${resigningPlayerColor === 'w' ? 'White' : 'Black'} resigned.`,
        moveHistory: room.moveHistory || []
      });
      console.log('Resigned match result saved for room:', roomId);
    } catch (err) { console.error('Error saving resigned match:', err); }
    room.game = null; room.players.forEach(p => p.ready = false);
  });

  socket.on('offerDraw', ({ roomId, offeringUserId }) => {
    const room = rooms[roomId];
    if (!room || !room.game || room.players.length !== 2 ) return;
    const offeringPlayer = room.players.find(p => p.userId === offeringUserId && p.socketId === socket.id);
    if(!offeringPlayer) return;
    const opponent = room.players.find(p => p.socketId !== socket.id);
    if (opponent) {
        room.drawOffer = { from: offeringUserId, to: opponent.userId, offeredBySocketId: socket.id };
        io.to(opponent.socketId).emit('drawOffered', { roomId, offeringUserId, offeringUsername: offeringPlayer.username });
        console.log(`User ${offeringPlayer.username} offered draw in room ${roomId}`);
    }
  });

  socket.on('respondToDrawOffer', async ({ roomId, respondingUserId, accepted }) => {
    const room = rooms[roomId];
    if (!room || !room.game || !room.drawOffer || room.drawOffer.to !== respondingUserId) return;
    
    const offeringPlayerEntry = room.players.find(p => p.userId === room.drawOffer.from);
    if (!offeringPlayerEntry) return;

    io.to(room.drawOffer.offeredBySocketId).emit('drawOfferResponded', { roomId, accepted, respondingUserId });

    if (accepted) {
      const result = '1/2-1/2';
      const finalMessage = 'Draw by agreement.';
      console.log(`Draw agreed in room ${roomId}.`);
      io.to(roomId).emit('gameEndedByServer', { roomId, result, message: finalMessage, finalFen: room.game.fen });
      try {
        await Match.create({
          roomId, whitePlayerId: room.playerDetails.white, blackPlayerId: room.playerDetails.black,
          result, playedAt: new Date(), finalFen: room.game.fen, notes: "Draw by agreement.",
          moveHistory: room.moveHistory || []
        });
         console.log('Agreed draw saved for room:', roomId);
      } catch (err) { console.error('Error saving agreed draw:', err); }
      room.game = null; room.players.forEach(p => p.ready = false);
    }
    delete room.drawOffer;
  });

  socket.on('requestRematch', ({ roomId, userId }) => {
    const room = rooms[roomId];
    if (!room || !room.players.find(p => p.userId === userId && p.socketId === socket.id)) return;
    const playerRequesting = room.players.find(p => p.socketId === socket.id);
    if(!playerRequesting) return;
    playerRequesting.wantsRematch = true;
    const opponent = room.players.find(p => p.socketId !== socket.id);
    if (opponent) {
        io.to(opponent.socketId).emit('rematchRequested', { roomId, fromUserId: userId, fromUsername: playerRequesting.username });
        if (opponent.wantsRematch) {
            console.log(`Rematch agreed in room ${roomId}.`);
            room.players.forEach(p => { p.ready = true; p.wantsRematch = false; });
            room.game = null; room.playerDetails = {}; room.moveHistory = [];
            checkAndStartOrResendGame(roomId, io);
        } else {
            socket.emit('rematchStatus', { roomId, message: 'Rematch offer sent. Waiting for opponent...' });
        }
    }
  });
  
  socket.on('acceptRematch', ({roomId, userId}) => {
    const room = rooms[roomId];
    if (!room || !room.players.find(p => p.userId === userId && p.socketId === socket.id)) return;
    const playerAccepting = room.players.find(p => p.socketId === socket.id);
    if(!playerAccepting) return;
    playerAccepting.wantsRematch = true; 
    
    const opponent = room.players.find(p => p.socketId !== socket.id);
    if (opponent && opponent.wantsRematch) {
        console.log(`Rematch confirmed by both players in room ${roomId}.`);
        room.players.forEach(p => { p.ready = true; p.wantsRematch = false; });
        room.game = null; room.playerDetails = {}; room.moveHistory = [];
        checkAndStartOrResendGame(roomId, io);
    } else if (opponent) {
        io.to(opponent.socketId).emit('rematchStatus', { roomId, acceptedRematch: true, message: `Player ${playerAccepting.username} accepted rematch. Starting new game...`});
        // Start game immediately after one accepts if the other already requested
         room.players.forEach(p => { p.ready = true; p.wantsRematch = false; });
         room.game = null; room.playerDetails = {}; room.moveHistory = [];
         checkAndStartOrResendGame(roomId, io);
    }
  });

  socket.on('declineRematch', ({roomId, toUserId}) => {
    const room = rooms[roomId];
    if (!room || !room.players) return;
    const playerToInform = room.players.find(p => p.userId === toUserId);
    if (playerToInform) {
        io.to(playerToInform.socketId).emit('rematchStatus', {roomId, acceptedRematch: false, message: 'Opponent declined the rematch offer.'});
    }
    room.players.forEach(p => p.wantsRematch = false); // Reset rematch status for all
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    for (const timeKey in matchmakingQueue) {
      const playerIndex = matchmakingQueue[timeKey].findIndex(p => p.socketId === socket.id);
      if (playerIndex !== -1) {
        const removedPlayer = matchmakingQueue[timeKey].splice(playerIndex, 1)[0];
        if (matchmakingQueue[timeKey].length === 0) delete matchmakingQueue[timeKey];
        console.log(`Player ${removedPlayer.username || removedPlayer.userId} removed from matchmaking queue (${timeKey}) due to disconnect.`);
        break; 
      }
    }
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
      if (playerIndex !== -1) {
        const disconnectedPlayer = room.players.splice(playerIndex, 1)[0];
        console.log(`User ${disconnectedPlayer.username || disconnectedPlayer.userId} disconnected from room ${roomId}.`);
        const remainingPlayer = room.players[0];
        if (room.game && (room.playerDetails.white === disconnectedPlayer.userId || room.playerDetails.black === disconnectedPlayer.userId)) {
            if (remainingPlayer) {
                io.to(remainingPlayer.socketId).emit('opponentDisconnected', {
                    roomId, message: 'Opponent has disconnected. You win!'
                });
                const result = room.playerDetails.white === remainingPlayer.userId ? '1-0' : '0-1';
                Match.create({
                    roomId, whitePlayerId: room.playerDetails.white, blackPlayerId: room.playerDetails.black,
                    result: result, playedAt: new Date(), finalFen: room.game.fen,
                    notes: "Opponent disconnected", moveHistory: room.moveHistory || []
                }).catch(err => console.error('Error saving match after disconnect:', err));
            }
        }
        room.game = null; room.playerDetails = {}; room.moveHistory = [];
        room.players.forEach(p => {p.ready = false; p.wantsRematch = false; });
        if (room.players.length === 0) {
          delete rooms[roomId];
          console.log(`Room ${roomId} deleted.`);
        }
        break;
      }
    }
  });
});

function checkAndStartOrResendGame(roomId, ioInstance) {
  const room = rooms[roomId];
  if (!room || !room.players) {
    console.log(`checkAndStartOrResendGame: Room ${roomId} not found or no players array.`);
    return;
  }
  console.log(`checkAndStartOrResendGame for Room ${roomId}. Players count: ${room.players.length}. Players:`, JSON.stringify(room.players.map(p => ({userId: p.userId, username:p.username, ready: p.ready}))));
  console.log(`Room game state:`, room.game ? JSON.stringify(room.game) : null);
  console.log(`Room playerDetails:`, room.playerDetails ? JSON.stringify(room.playerDetails) : null);

  const areBothPlayersPresent = room.players.length === 2;
  const areAllPlayersReady = areBothPlayersPresent && room.players.every(p => p.ready);
  const isGameNotStarted = !room.game;

  console.log(`Check conditions - BothPresent: ${areBothPlayersPresent}, AllReady: ${areAllPlayersReady}, GameNotStarted: ${isGameNotStarted}`);

  if (areBothPlayersPresent && areAllPlayersReady && isGameNotStarted) {
    console.log(`Conditions met for new game in room ${roomId}. Starting...`);
    room.moveHistory = [];
    const [player1_entry, player2_entry] = room.players;
    const whitePlayer = Math.random() < 0.5 ? player1_entry : player2_entry;
    const blackPlayer = whitePlayer === player1_entry ? player2_entry : player1_entry;

    room.playerDetails = { white: whitePlayer.userId, black: blackPlayer.userId };
    const initialFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    room.game = { fen: initialFen, turn: 'w' };
    const initialGameStatePayloadBase = {
      roomId: roomId, fen: initialFen, turn: 'w', 
      playerIds: room.playerDetails, moveHistory: room.moveHistory, 
      timeControl: room.timeControl 
    };
    console.log(`Emitting 'initialGameState' to White (${whitePlayer.username} at ${whitePlayer.socketId})`);
    ioInstance.to(whitePlayer.socketId).emit('initialGameState', { ...initialGameStatePayloadBase, playerColor: 'w', opponent: {userId: blackPlayer.userId, username: blackPlayer.username} });
    console.log(`Emitting 'initialGameState' to Black (${blackPlayer.username} at ${blackPlayer.socketId})`);
    ioInstance.to(blackPlayer.socketId).emit('initialGameState', { ...initialGameStatePayloadBase, playerColor: 'b', opponent: {userId: whitePlayer.userId, username: whitePlayer.username} });
    console.log(`Game started. White: ${whitePlayer.username}, Black: ${blackPlayer.username}.`);

  } else if (room.game && areBothPlayersPresent && room.playerDetails.white && room.playerDetails.black) {
    console.log(`Game already exists in room ${roomId}. Resending current game state.`);
    const whitePlayerSocketEntry = room.players.find(p => p.userId === room.playerDetails.white);
    const blackPlayerSocketEntry = room.players.find(p => p.userId === room.playerDetails.black);
    const currentGameStatePayloadBase = {
        roomId: roomId, fen: room.game.fen, turn: room.game.turn, 
        playerIds: room.playerDetails, moveHistory: room.moveHistory, 
        timeControl: room.timeControl
    };
    if (whitePlayerSocketEntry) ioInstance.to(whitePlayerSocketEntry.socketId).emit('initialGameState', {...currentGameStatePayloadBase, playerColor: 'w', opponent: blackPlayerSocketEntry ? {userId: blackPlayerSocketEntry.userId, username: blackPlayerSocketEntry.username} : null});
    if (blackPlayerSocketEntry) ioInstance.to(blackPlayerSocketEntry.socketId).emit('initialGameState', {...currentGameStatePayloadBase, playerColor: 'b', opponent: whitePlayerSocketEntry ? {userId: whitePlayerSocketEntry.userId, username: whitePlayerSocketEntry.username} : null});
  } else {
    console.log(`Conditions NOT met to start or resend game in room ${roomId}. Waiting...`);
    if (areBothPlayersPresent && !areAllPlayersReady) {
        room.players.forEach(p => {
            if (p.socketId) {
                 ioInstance.to(p.socketId).emit('roomStatusUpdate', { roomId, message: `Waiting for players to be ready (${room.players.filter(pl=>pl.ready).length}/2)`});
            }
        });
        console.log(`Waiting for all players to be ready. Players ready status:`, JSON.stringify(room.players.map(p => ({userId: p.userId, username: p.username, ready: p.ready}))));
    } else if (!areBothPlayersPresent && room.players.length === 1) {
        const singlePlayer = room.players[0];
        if (singlePlayer && singlePlayer.socketId) {
            ioInstance.to(singlePlayer.socketId).emit('roomStatusUpdate', { roomId, message: `Waiting for opponent... (1/2)`});
        }
        console.log(`Not enough players in room ${roomId}. Current: 1`);
    }
  }
}

server.listen(PORT, () => console.log(`Server & Socket running at http://localhost:${PORT}`));