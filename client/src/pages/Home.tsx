import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { getSocket } from '../socket/client';
import { selfSeatAssigned } from '../store/connection.slice';

export function Home() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const create = () => {
    if (!name.trim()) { setError('Please enter a name'); return; }
    getSocket().emit('room:create', { name: name.trim() }, (resp: { seatId: string; roomId: string } | { ok: false; code: string }) => {
      if ('seatId' in resp) {
        dispatch(selfSeatAssigned(resp.seatId));
        navigate(`/room/${resp.roomId}`);
      } else setError(resp?.code ?? 'Failed to create room');
    });
  };

  const join = () => {
    if (!name.trim()) { setError('Please enter a name'); return; }
    if (!code.trim()) { setError('Please enter a room code'); return; }
    const roomCode = code.trim().toUpperCase();
    getSocket().emit('room:join', { roomId: roomCode, name: name.trim() }, (resp: any) => {
      if (resp?.seatId) {
        dispatch(selfSeatAssigned(resp.seatId));
        navigate(`/room/${roomCode}`);
      } else setError(resp?.code ?? 'Failed to join');
    });
    getSocket().once('error', (err: { message: string }) => setError(err.message));
  };

  return (
    <div className="home">
      <h1>Blackjack 21</h1>
      <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
      <div>
        <button onClick={create}>Create Room</button>
        <span> or </span>
        <input placeholder="Room code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <button onClick={join}>Join</button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
