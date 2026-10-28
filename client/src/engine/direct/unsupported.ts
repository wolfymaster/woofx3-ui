import { GatewayUnsupportedError } from "@/engine/errors";

// Members whose data is kept somewhere a client of the engine alone does not
// reach. A read throws and a request rejects, named after the member, rather
// than answering empty: an empty answer would read as the truth.

/** A read hook that throws for `member` (`namespace.useMember`). */
export function unsupportedRead(member: string): () => never {
  return () => {
    throw new GatewayUnsupportedError(member);
  };
}

/** A request hook whose function rejects for `member` (`namespace.useMemberRequest`). */
export function unsupportedRequest(member: string): () => () => Promise<never> {
  const reject = async (): Promise<never> => {
    throw new GatewayUnsupportedError(member);
  };
  return () => reject;
}
