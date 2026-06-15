import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function connect(): Socket {
  if (socket) return socket;
  socket = io('http://localhost:3001', { autoConnect: true, transports: ['websocket'] });
  return socket;
}

export function getSocket(): Socket {
  if (!socket) return connect();
  return socket;
}
