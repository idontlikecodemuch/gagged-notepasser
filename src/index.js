const MAX_BODY_BYTES = 20_000;

const ROUTES = {
  "/v1/generate/clean": "clean",
  "/v1/generate/spicy": "spicy",
  "/clean": "clean",
  "/spicy": "spicy",
};

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch {
      return json({ error: "internal_error" }, 500);
    }
  },
};

async function handleRequest(request, env) {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/") {
    return json({
      service: "GAGGED Notepasser",
      purpose: "AI provider key custody and request forwarding",
      privacy: "No prompt, response, or deck storage by this Worker.",
      source: "https://github.com/idontlikecodemuch/gagged-notepasser",
      routes: ["/v1/generate/clean", "/v1/generate/spicy"],
    });
  }

  if (request.method === "GET" && url.pathname === "/health") {
    return json({ ok: true });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "allow": "POST, OPTIONS",
        "cache-control": "no-store",
      },
    });
  }

  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, {
      "allow": "POST, OPTIONS",
    });
  }

  const route = ROUTES[url.pathname];
  if (!route) {
    return json({ error: "not_found" }, 404);
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json({ error: "json_required" }, 415);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ error: "request_too_large" }, 413);
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    return json({ error: "request_too_large" }, 413);
  }

  const upstream = upstreamForRoute(route, env);
  if (!upstream.ok) {
    return json({ error: "proxy_not_configured", missing: upstream.missing }, 500);
  }

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstream.url, {
      method: "POST",
      headers: upstream.headers,
      body,
    });
  } catch {
    return json({ error: "upstream_unavailable" }, 502);
  }

  const responseHeaders = new Headers({
    "cache-control": "no-store",
  });
  const upstreamContentType = upstreamResponse.headers.get("content-type");
  if (upstreamContentType) {
    responseHeaders.set("content-type", upstreamContentType);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

function upstreamForRoute(route, env) {
  if (route === "clean") {
    return buildUpstream({
      url: env.GEMINI_URL,
      key: env.GEMINI_API_KEY,
      keyName: "GEMINI_API_KEY",
      urlName: "GEMINI_URL",
      headers: (key) => ({
        "content-type": "application/json",
        "x-goog-api-key": key,
      }),
    });
  }

  if (route === "spicy") {
    return buildUpstream({
      url: env.XAI_URL,
      key: env.XAI_API_KEY,
      keyName: "XAI_API_KEY",
      urlName: "XAI_URL",
      headers: (key) => ({
        "content-type": "application/json",
        "authorization": `Bearer ${key}`,
      }),
    });
  }

  return { ok: false, missing: ["route"] };
}

function buildUpstream({ url, key, keyName, urlName, headers }) {
  const missing = [];
  if (!url) missing.push(urlName);
  if (!key) missing.push(keyName);
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return { ok: true, url, headers: headers(key) };
}

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

