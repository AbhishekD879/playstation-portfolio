import { onRequestGet as __api_browse_ts_onRequestGet } from "/Users/abhishekdiwate/playstation-portfolio/functions/api/browse.ts"
import { onRequestGet as __api_guestbook_ts_onRequestGet } from "/Users/abhishekdiwate/playstation-portfolio/functions/api/guestbook.ts"
import { onRequestPost as __api_guestbook_ts_onRequestPost } from "/Users/abhishekdiwate/playstation-portfolio/functions/api/guestbook.ts"

export const routes = [
    {
      routePath: "/api/browse",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_browse_ts_onRequestGet],
    },
  {
      routePath: "/api/guestbook",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_guestbook_ts_onRequestGet],
    },
  {
      routePath: "/api/guestbook",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_guestbook_ts_onRequestPost],
    },
  ]