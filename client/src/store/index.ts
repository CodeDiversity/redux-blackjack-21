import { configureStore } from '@reduxjs/toolkit';
import { connectionReducer } from './connection.slice';
import { lobbyReducer } from './lobby.slice';
import { gameReducer } from './game.slice';
import { uiReducer } from './ui.slice';
import { socketMiddleware } from '../middleware/socket.middleware';
import { getSocket } from '../socket/client';

export const store = configureStore({
  reducer: {
    connection: connectionReducer,
    lobby: lobbyReducer,
    game: gameReducer,
    ui: uiReducer,
  },
  middleware: (getDefault) => getDefault().concat(socketMiddleware(getSocket)),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
