import { Trans } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSpaceQueries } from "../lib/query";

/** Dedicated read surface: no composer, tool actions, file access or bot settings. */
export function BotReaderPage() {
  const { botId = "" } = useParams();
  const queries = useSpaceQueries();
  const [before, setBefore] = useState<number>();
  const result = useQuery({
    ...queries.botReaders.messages.queryOptions({ input: { botId, before } }),
    refetchInterval: before === undefined ? 2000 : false,
    retry: false,
  });
  return (
    <main className="flex h-full flex-col bg-background text-foreground">
      <header className="flex items-center gap-4 border-b p-4">
        <Link to="/app">
          <Trans>Back</Trans>
        </Link>
        <h1 className="font-medium">{result.data?.name}</h1>
        <span className="text-sm text-muted-foreground">
          <Trans>Read only</Trans>
        </span>
      </header>
      <div className="flex-1 overflow-auto p-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {result.isError || result.isRefetchError ? (
            <p role="alert">
              <Trans>Couldn't load this conversation.</Trans>
            </p>
          ) : result.isPending ? (
            <p>
              <Trans>Loading…</Trans>
            </p>
          ) : (
            <>
              <div className="flex gap-2">
                {result.data.nextBefore !== undefined ? (
                  <Button variant="outline" onClick={() => setBefore(result.data.nextBefore)}>
                    <Trans>Older messages</Trans>
                  </Button>
                ) : null}
                {before !== undefined ? (
                  <Button variant="outline" onClick={() => setBefore(undefined)}>
                    <Trans>Latest messages</Trans>
                  </Button>
                ) : null}
              </div>
              {result.data.messages
                .filter((message) => message.text)
                .map((message) => (
                  <article key={message.id} className="rounded-lg border p-4">
                    <p className="mb-2 text-sm text-muted-foreground">
                      {message.role === "bot" ? result.data.name : <Trans>Owner</Trans>}
                      {" · "}
                      {new Date(message.createdAt).toLocaleString()}
                    </p>
                    <p className="whitespace-pre-wrap break-words">{message.text}</p>
                  </article>
                ))}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export function SharedBotLinks({ navigate }: { navigate: (path: string) => void }) {
  const queries = useSpaceQueries();
  const shared = useQuery({
    ...queries.botReaders.list.queryOptions(),
    refetchInterval: 15000,
  });
  if (shared.isError || !shared.data?.length) return null;
  return (
    <nav className="flex flex-col gap-1 px-2 py-2">
      {shared.data.map((bot) => (
        <Button
          key={bot.id}
          variant="ghost"
          className="justify-start"
          onClick={() => navigate(`/app/read/${bot.id}`)}
        >
          {bot.name} · <Trans>Read only</Trans>
        </Button>
      ))}
    </nav>
  );
}
