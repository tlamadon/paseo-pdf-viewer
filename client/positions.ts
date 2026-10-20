// Where each document was left, so switching tabs and back does not lose the place. Positions
// are a page plus a fraction of it, which survives window resizes and zoom changes. Kept in
// memory for the app session.
export interface ViewerPosition {
  page: number;
  fraction: number;
  zoomIndex: number;
}

const positions = new Map<string, ViewerPosition>();
const MAX_POSITIONS = 100;

export function readPosition(key: string): ViewerPosition | undefined {
  return positions.get(key);
}

export function writePosition(key: string, position: ViewerPosition): void {
  positions.delete(key);
  positions.set(key, position);
  if (positions.size > MAX_POSITIONS) positions.delete(positions.keys().next().value as string);
}
