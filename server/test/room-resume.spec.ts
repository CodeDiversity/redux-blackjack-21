import { RoomService } from '../src/room/room.service';

describe('RoomService (resume support)', () => {
  it('assigns a stable seatId and a separate seatToken when a player joins', () => {
    const svc = new RoomService();
    const { seatId, seatToken } = svc.createRoom('socket-A', 'Alice');
    expect(seatId).toBeTruthy();
    expect(seatToken).toBeTruthy();
    expect(seatId).not.toBe(seatToken);
    // A second player in the same room must get a different seatId.
    const roomId = (svc as any).rooms.values().next().value.id;
    const join = svc.joinRoom(roomId, 'socket-B', 'Bob');
    expect(join.seatId).not.toBe(seatId);
    expect(join.seatToken).not.toBe(seatToken);
  });
});
