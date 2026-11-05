import { ORPCError } from "@orpc/server";
import type { Actor } from "@rakazo/contracts";
import { MODEL_REQUIRED_SEND_ERROR } from "@rakazo/core";
import { createBotReaderRepos, IsolationError } from "@rakazo/db";
import { sendThreadMessage } from "../thread-target.js";
import type { RouterContext } from "./context.js";
import { botsRunOwnModels, modelSetup } from "./shared.js";

export function botReadersRoutes({ authed, deps, repos }: RouterContext) {
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
      /**
       * A participant sends as themselves into the owner's bot thread. The turn runs in the
       * owner's tenant (their model credentials), with the participant named in the text;
       * participants never gain settings, approvals or file access.
       */
      send: authed.botReaders.send.handler(({ context, input }) =>
        read(async () => {
          const actor = context.actor;
          const target = await readers.sendTarget(actor, input.botId);
          const [owner, participant] = await Promise.all([
            deps.prisma.user.findUnique({
              where: { id: target.ownerId },
              select: { email: true },
            }),
            deps.prisma.user.findUnique({
              where: { id: actor.userId },
              select: { name: true, email: true },
            }),
          ]);
          const ownerActor: Actor = {
            ...actor,
            userId: target.ownerId,
            email: owner?.email ?? actor.email,
          };
          const setup = await modelSetup(deps, ownerActor);
          const bot = await repos.getBot(ownerActor, target.botId);
          const threadTarget = {
            kind: "bot" as const,
            botId: target.botId,
            threadId: target.threadId,
            bot,
          };
          if (setup.needsModel && !(await botsRunOwnModels(deps, ownerActor, [target.botId]))) {
            throw new ORPCError("BAD_REQUEST", { message: MODEL_REQUIRED_SEND_ERROR });
          }
          // Messages carry no author column, so the participant is named in the text itself.
          const sender = participant?.name?.trim() || participant?.email || actor.email;
          await sendThreadMessage({ ...deps }, ownerActor, threadTarget, {
            text: `From ${sender} (participant): ${input.text}`,
          });
          return { ok: true as const };
        }),
      ),
    },
  };
}
