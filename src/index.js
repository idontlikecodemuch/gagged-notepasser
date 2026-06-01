const MAX_BODY_BYTES = 20_000;
const BUILD_PATH = "/build";
const LANE_HEADER = "x-gagged-lane";
const BETA_CODE_HEADER = "x-gagged-ticket";
const BETA_CODE_BINDING = "GAGGED_BETA_CODE";
const DEFAULT_GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent";
const DEFAULT_XAI_URL = "https://api.x.ai/v1/chat/completions";
const GEMINI_KEY_BINDINGS = [
  "gagged-prod-gemini-API1",
  "gagged-prod-gemini-API2",
];
const XAI_KEY_BINDING = "gagged-xai-key";
const LANES = {
  standard: "standard",
  edge: "edge",
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
      routes: ["/build", "/health"],
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

  if (url.pathname !== BUILD_PATH) {
    return json({ error: "not_found" }, 404);
  }

  const lane = laneForRequest(request);
  if (!lane) {
    return json({ error: "invalid_lane" }, 400);
  }

  const betaGate = validateBetaGate(request, env);
  if (!betaGate.configured) {
    return json({ error: "proxy_not_configured", missing: [BETA_CODE_BINDING] }, 500);
  }
  if (!betaGate.authorized) {
    return json({ error: "forbidden" }, 403);
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

  const upstreams = upstreamsForLane(lane, env);
  if (!upstreams.ok) {
    return json({ error: "proxy_not_configured", missing: upstreams.missing }, 500);
  }

  const upstreamResult = await fetchWithFallback(upstreams.items, body);
  if (!upstreamResult.ok) {
    return json({ error: "upstream_unavailable" }, 502);
  }
  const upstreamResponse = upstreamResult.response;

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

function laneForRequest(request) {
  const value = (request.headers.get(LANE_HEADER) || "").trim().toLowerCase();
  return LANES[value] || null;
}

function validateBetaGate(request, env) {
  const expected = env[BETA_CODE_BINDING];
  if (!expected) {
    return { configured: false, authorized: false };
  }

  const provided = request.headers.get(BETA_CODE_HEADER) || "";
  return {
    configured: true,
    authorized: constantTimeEqual(provided, expected),
  };
}

function constantTimeEqual(left, right) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }

  return diff === 0;
}

async function fetchWithFallback(upstreams, body) {
  for (let index = 0; index < upstreams.length; index += 1) {
    const upstream = upstreams[index];
    let response;
    try {
      response = await fetch(upstream.url, {
        method: "POST",
        headers: upstream.headers,
        body,
      });
    } catch {
      if (index === upstreams.length - 1) {
        return { ok: false };
      }
      continue;
    }

    const shouldFallback = response.status === 429 && index < upstreams.length - 1;
    if (!shouldFallback) {
      return { ok: true, response };
    }
  }

  return { ok: false };
}

function upstreamsForLane(lane, env) {
  if (lane === "standard") {
    const keys = GEMINI_KEY_BINDINGS
      .map((name) => ({ name, value: env[name] }))
      .filter((item) => Boolean(item.value));

    if (keys.length === 0) {
      return { ok: false, missing: GEMINI_KEY_BINDINGS };
    }

    const url = env.GAGGED_GEMINI_URL || DEFAULT_GEMINI_URL;
    return {
      ok: true,
      items: keys.map((key) => ({
        url,
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": key.value,
        },
      })),
    };
  }

  if (lane === "edge") {
    const key = env[XAI_KEY_BINDING];
    if (!key) {
      return { ok: false, missing: [XAI_KEY_BINDING] };
    }

    return {
      ok: true,
      items: [{
        url: env.GAGGED_XAI_URL || DEFAULT_XAI_URL,
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${key}`,
        },
      }],
    };
  }

  return { ok: false, missing: ["lane"] };
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
