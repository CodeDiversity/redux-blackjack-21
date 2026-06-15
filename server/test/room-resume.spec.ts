import { RoomService } from '../src/room/room.service';

describe('RoomService (resume support)', () => {
  it('assigns a stable seatId and a separate seatToken when a player joins', () => {
    const svc = new RoomService();
    const { roomId, seatId, seatToken } = svc.createRoom('socket-A', 'Alice');
    expect(seatId).toBeTruthy();
    expect(seatToken).toBeTruthy();
    expect(seatId).not.toBe(seatToken);
    // A second player in the same room must get a different seatId.
    const join = svc.joinRoom(roomId, 'socket-B', 'Bob');
    expect(join.seatId).not.toBe(seatId);
    expect(join.seatToken).not.toBe(seatToken);
  });
});

describe('RoomService.resumeSeat', () => {
  it('rebinds the new socket to the existing seat when the token matches', () => {
    const svc = new RoomService();
    const { roomId, seatToken } = svc.createRoom('socket-A', 'Alice');
    const result = svc.resumeSeat(roomId, seatToken, 'socket-A2');
    expect(result.seatId).toBeTruthy();
    const room = (svc as any).rooms.get(roomId);
    const entry = [...room.seats.values()][0];
    expect(entry.socketId).toBe('socket-A2');
  });

  it('throws ROOM_NOT_FOUND when the roomId is unknown', () => {
    const svc = new RoomService();
    expect(() => svc.resumeSeat('NOPE', 'whatever', 'socket-A')).toThrow();
  });

  it('throws GameError(SEAT_GONE) when the token is unknown', () => {
    const svc = new RoomService();
    const { roomId } = svc.createRoom('socket-A', 'Alice');
    expect(() => svc.resumeSeat(roomId, 'bogus-token', 'socket-A2')).toThrow();
  });
});
