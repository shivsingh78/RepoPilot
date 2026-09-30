import { v7 as uuidv7 } from "uuid";

/** Time-ordered UUID v7 for all primary keys (docs/DATABASE.md). */
export function newId(): string {
  return uuidv7();
}
