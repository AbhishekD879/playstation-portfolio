// jazz2: big binaries from R2, everything else static — see functions/r2serve.ts
import { serveFromR2, type R2Env } from "../r2serve";

export const onRequest: PagesFunction<R2Env> = (ctx) => serveFromR2(ctx, "jazz2");
