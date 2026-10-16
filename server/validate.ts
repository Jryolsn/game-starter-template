// Kontrollerar allt som kommer från klienten mot ClientMsgSchema innan det når rummen.
// Okända fält tas bort, och fel typ, för långa strängar eller värden utanför gränserna avvisas.
import * as v from "valibot";
import { type ClientMsg, ClientMsgSchema } from "../shared/protocol.ts";

export function parseClientMsg(raw: string): ClientMsg | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = v.safeParse(ClientMsgSchema, data);
  return result.success ? result.output : null;
}
