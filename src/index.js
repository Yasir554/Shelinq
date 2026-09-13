const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function withCors(response) {
  const newHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => newHeaders.set(key, value));
  return new Response(response.body, {
    status: response.status,
    headers: newHeaders
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    let response;

    if (url.pathname === "/api/login" && request.method === "POST") {
      response = await handleLogin(request, env);
    } else if (url.pathname === "/api/books/upload" && request.method === "POST") {
      const authError = await checkAuth(request, env);
      response = authError || await handleUpload(request, env, url);
    } else if (url.pathname === "/api/books" && request.method === "GET") {
      const authError = await checkAuth(request, env);
      response = authError || await handleList(env);
    } else if (url.pathname.startsWith("/api/books/") && request.method === "PUT") {
      const authError = await checkAuth(request, env);
      const slug = url.pathname.replace("/api/books/", "");
      response = authError || await handleEdit(slug, request, env);
    } else if (url.pathname.startsWith("/api/books/") && request.method === "DELETE") {
      const authError = await checkAuth(request, env);
      const slug = url.pathname.replace("/api/books/", "");
      response = authError || await handleDelete(slug, env);
    } else if (url.pathname.startsWith("/b/")) {
      const slug = url.pathname.replace("/b/", "");
      response = await handleRedirect(slug, env);
    } else {
      response = new Response("Shelinq Worker is running!");
    }

    return withCors(response);
  }
};

// ---------- AUTH HELPERS ----------

async function handleLogin(request, env) {
  const { password } = await request.json();

  if (password !== env.ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: "Invalid password" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const token = await createToken(env.JWT_SECRET);

  return new Response(JSON.stringify({ token }), {
    headers: { "Content-Type": "application/json" }
  });
}

async function createToken(secret) {
  const payload = { exp: Date.now() + 1000 * 60 * 30 }; // 30 minute expiry
  const payloadB64 = btoa(JSON.stringify(payload));
  const signature = await sign(payloadB64, secret);
  return `${payloadB64}.${signature}`;
}

async function verifyToken(token, secret) {
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return false;

  const expectedSignature = await sign(payloadB64, secret);
  if (signature !== expectedSignature) return false;

  const payload = JSON.parse(atob(payloadB64));
  if (Date.now() > payload.exp) return false;

  return true;
}

async function sign(data, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));
}

async function checkAuth(request, env) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const token = authHeader.replace("Bearer ", "");
  const valid = await verifyToken(token, env.JWT_SECRET);

  if (!valid) {
    return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  return null; // no error means auth passed
}

// ---------- BOOK HANDLERS ----------

async function handleUpload(request, env, url) {
  const formData = await request.formData();
  const file = formData.get("file");
  const title = formData.get("title");

  if (!file || !title) {
    return new Response(JSON.stringify({ error: "Missing file or title" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  let baseSlug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  let slug = baseSlug;
  let counter = 2;

  while (true) {
    const existing = await env.DB.prepare("SELECT id FROM books WHERE slug = ?")
      .bind(slug)
      .first();
    if (!existing) break;
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  const r2Key = `${slug}.pdf`;

  await env.BOOKS_BUCKET.put(r2Key, file.stream());

  await env.DB.prepare(
    "INSERT INTO books (title, slug, r2_key, status) VALUES (?, ?, ?, 'active')"
  ).bind(title, slug, r2Key).run();

  return new Response(JSON.stringify({ slug, redirect_url: `${url.origin}/b/${slug}` }), {
    headers: { "Content-Type": "application/json" }
  });
}

async function handleList(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, title, slug, created_at FROM books WHERE status = 'active' ORDER BY created_at DESC"
  ).all();

  return new Response(JSON.stringify(results), {
    headers: { "Content-Type": "application/json" }
  });
}

async function handleEdit(slug, request, env) {
  const book = await env.DB.prepare(
    "SELECT * FROM books WHERE slug = ?"
  ).bind(slug).first();

  if (!book || book.status !== "active") {
    return new Response(JSON.stringify({ error: "Book not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }

  const formData = await request.formData();
  const newTitle = formData.get("title");
  const newFile = formData.get("file");

  if (newTitle) {
    await env.DB.prepare("UPDATE books SET title = ? WHERE slug = ?")
      .bind(newTitle, slug)
      .run();
  }

  if (newFile) {
    await env.BOOKS_BUCKET.put(book.r2_key, newFile.stream());
  }

  return new Response(JSON.stringify({ success: true, slug }), {
    headers: { "Content-Type": "application/json" }
  });
}

async function handleDelete(slug, env) {
  await env.DB.prepare(
    "UPDATE books SET status = 'deleted' WHERE slug = ?"
  ).bind(slug).run();

  return new Response(JSON.stringify({ success: true, slug }), {
    headers: { "Content-Type": "application/json" }
  });
}

async function handleRedirect(slug, env) {
  const book = await env.DB.prepare(
    "SELECT * FROM books WHERE slug = ?"
  ).bind(slug).first();

  if (!book || book.status !== "active") {
    return new Response(
      `<html><body style="font-family: sans-serif; text-align: center; padding: 50px;">
        <h2>This book is no longer available</h2>
      </body></html>`,
      { status: 404, headers: { "Content-Type": "text/html" } }
    );
  }

  const object = await env.BOOKS_BUCKET.get(book.r2_key);

  if (!object) {
    return new Response("File not found", { status: 404 });
  }

  return new Response(object.body, {
    headers: { "Content-Type": "application/pdf" }
  });
}