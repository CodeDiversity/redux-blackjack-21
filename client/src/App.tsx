import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { connect } from './socket/client';
import { connectionEstablished, selfSeatAssigned } from './store/connection.slice';
import { attachSocketListeners } from './middleware/socket.middleware';
import { Home } from './pages/Home';
import { Table } from './pages/Table';

export function App() {
  const dispatch = useDispatch();
  useEffect(() => {
    const socket = connect();
    attachSocketListeners(socket, dispatch);
    socket.on('connect', () => dispatch(connectionEstablished(socket.id ?? '')));
    // When the server returns a seatId via the create/join ack, remember it.
    socket.on('room:create:ack', (resp: { seatId: string }) => { if (resp?.seatId) dispatch(selfSeatAssigned(resp.seatId)); });
  }, [dispatch]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:code" element={<Table />} />
      </Routes>
    </BrowserRouter>
  );
}
