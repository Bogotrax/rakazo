import { ORPCError } from "@orpc/server";
import { createBotReaderRepos, IsolationError } from "@rakazo/db";
import type { RouterContext } from "./context.js";

export function botReadersRoutes({ authed, deps }: RouterContext) {
  const readers = createBotReaderRepos(deps.prisma);
  async function read<T>(operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof IsolationError) throw new ORPCError("NOT_FOUND");
      throw error;
    }
  }
  return {
    botReaders: {
      list: authed.botReaders.list.handler(({ context }) =>
        read(() => readers.list(context.actor)),
      ),
      messages: authed.botReaders.messages.handler(({ context, input }) =>
        read(() => readers.messages(context.actor, input.botId, input.before)),
      ),
    },
  };
}
