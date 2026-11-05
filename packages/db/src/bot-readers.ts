import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "./client.js";
import { runAsSystem, runAsTenant } from "./row-security.js";
import { IsolationError } from "./scope.js";

export type BotReaderRole = "reader" | "participant";

/** A grant never replaces Space membership or grants access to write operations. */
export function createBotReaderRepos(prisma: PrismaClient) {
  const sharedWhere = (actor: Actor) => ({
    spaceId: actor.spaceId,
    archivedAt: null,
    userId: { not: actor.userId },
  });

  async function grants(actor: Actor) {
    const member = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: actor.spaceId, userId: actor.userId } },
    });
    if (!member) throw new IsolationError();
    const rows = await prisma.botReader.findMany({
      where: { userId: actor.userId },
      select: { botId: true, role: true },
    });
    return new Map(rows.map((row) => [row.botId, row.role as BotReaderRole]));
  }

  /**
   * The bot a participant may write into, with the owner who executes the turn.
   */
  async function participantBot(actor: Actor, botId: string) {
    const byId = await grants(actor);
    if (byId.get(botId) !== "participant") throw new IsolationError();
    const bot = await prisma.bot.findFirst({
      where: { ...sharedWhere(actor), id: botId },
      select: { id: true, name: true, userId: true, thread: { select: { id: true } } },
    });
    const thread = bot?.thread;
    if (!bot || !thread) throw new IsolationError();
    return { ...bot, thread };
  }

  return {
    async list(actor: Actor) {
      return runAsSystem(
        "list explicitly shared bots after checking reader membership",
        async () => {
          const byId = await grants(actor);
          const bots = await prisma.bot.findMany({
            where: { ...sharedWhere(actor), id: { in: [...byId.keys()] } },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          });
          return bots.map((bot) => ({ ...bot, role: byId.get(bot.id) ?? "reader" }));
        },
      );
    },

    async messages(actor: Actor, botId: string, before?: number) {
      return runAsSystem(
        "resolve explicit bot read grant and current Space membership",
        async () => {
          const byId = await grants(actor);
          const role = byId.get(botId) ?? "reader";
          if (!byId.has(botId)) throw new IsolationError();
          const bot = await prisma.bot.findFirst({
            where: { ...sharedWhere(actor), id: botId },
            select: { id: true, name: true, userId: true, thread: { select: { id: true } } },
          });
          if (!bot?.thread) throw new IsolationError();
          // The owner's tenant is used only for this fixed read, never returned to the caller.
          return runAsTenant({ ...actor, userId: bot.userId }, async () => {
            const rows = await prisma.message.findMany({
              where: {
                threadId: bot.thread!.id,
                role: { in: ["user", "bot"] },
                ...(before === undefined ? {} : { seq: { lt: before } }),
              },
              orderBy: { seq: "desc" },
              take: 101,
            });
            const hasMore = rows.length > 100;
            const messages = rows.slice(0, 100).reverse();
            return {
              id: bot.id,
              name: bot.name,
              role,
              messages: messages.map((message) => ({
                id: message.id,
                seq: message.seq,
                role: message.role,
                // Only conversation text: no tool payloads, approvals or private file URLs.
                text: (Array.isArray(message.blocks) ? message.blocks : [])
                  .filter(
                    (block): block is { kind: string; text: string } =>
                      typeof block === "object" &&
                      block !== null &&
                      "kind" in block &&
                      block.kind === "text" &&
                      "text" in block &&
                      typeof block.text === "string",
                  )
                  .map((block) => block.text)
                  .join("\n\n"),
                createdAt: message.createdAt.toISOString(),
              })),
              nextBefore: hasMore ? messages[0]?.seq : undefined,
            };
          });
        },
      );
    },

    /** Participant write path: resolve the shared bot and its owning user for the send. */
    async sendTarget(actor: Actor, botId: string) {
      return runAsSystem(
        "resolve explicit participant grant and current Space membership",
        async () => {
          const bot = await participantBot(actor, botId);
          return { botId: bot.id, threadId: bot.thread.id, ownerId: bot.userId };
        },
      );
    },
  };
}
