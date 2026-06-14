import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { connect } from './socket/client';
import { connectionEstablished } from './store/connection.slice';

export function App() {
  const dispatch = useDispatch();
  useEffect(() => {
    const socket = connect();
    socket.on('connect', () => dispatch(connectionEstablished(socket.id ?? '')));
  }, [dispatch]);
  return <h1>Blackjack 21</h1>;
}
