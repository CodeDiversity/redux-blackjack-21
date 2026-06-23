import { RoomService } from '../src/room/room.service';

describe('RoomService (resume support)', () => {
  it('assigns a stable seatId and a separate seatToken when a player joins', () => {
    const svc = new RoomService();
    const { roomId, seatId, seatToken } = svc.createRoom('socket-A', 'Alice', '00000000-0000-4000-8000-000000000001');
    expect(seatId).toBeTruthy();
    expect(seatToken).toBeTruthy();
    expect(seatId).not.toBe(seatToken);
    // A second player in the same room must get a different seatId.
    const join = svc.joinRoom(roomId, 'socket-B', 'Bob', '00000000-0000-4000-8000-000000000001');
    expect(join.seatId).not.toBe(seatId);
    expect(join.seatToken).not.toBe(seatToken);
  });
});

describe('RoomService.resumeSeat', () => {
  it('rebinds the new socket to the existing seat when the token matches', () => {
    const svc = new RoomService();
    const { roomId, seatToken } = svc.createRoom('socket-A', 'Alice', '00000000-0000-4000-8000-000000000001');
    const result = svc.resumeSeat(roomId, seatToken, 'socket-A2', '00000000-0000-4000-8000-000000000001');
    expect(result.seatId).toBeTruthy();
    expect(svc.roomForSocket('socket-A2')).toEqual({ roomId, seatId: result.seatId });
    expect(svc.roomForSocket('socket-A')).toBeUndefined();
  });

  it('throws ROOM_NOT_FOUND when the roomId is unknown', () => {
    const svc = new RoomService();
    expect(() => svc.resumeSeat('NOPE', 'whatever', 'socket-A', '00000000-0000-4000-8000-000000000001')).toThrow('ROOM_NOT_FOUND');
  });

  it('throws SEAT_GONE when the token is unknown', () => {
    const svc = new RoomService();
    const { roomId } = svc.createRoom('socket-A', 'Alice', '00000000-0000-4000-8000-000000000001');
    expect(() => svc.resumeSeat(roomId, 'bogus-token', 'socket-A2', '00000000-0000-4000-8000-000000000001')).toThrow('SEAT_GONE');
  });
});
