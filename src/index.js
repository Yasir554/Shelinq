export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Upload a new book
    if (url.pathname === "/api/books/upload" && request.method === "POST") {
      return handleUpload(request, env, url);
    }

    // List all active books
    if (url.pathname === "/api/books" && request.method === "GET") {
      return handleList(env);
    }

    // Edit a book (title and/or replace PDF)
    if (url.pathname.startsWith("/api/books/") && request.method === "PUT") {
      const slug = url.pathname.replace("/api/books/", "");
      return handleEdit(slug, request, env);
    }

    // Delete a book (soft delete)
    if (url.pathname.startsWith("/api/books/") && request.method === "DELETE") {
      const slug = url.pathname.replace("/api/books/", "");
      return handleDelete(slug, env);
    }

    // Public redirect route (what the QR code points to)
    if (url.pathname.startsWith("/b/")) {
      const slug = url.pathname.replace("/b/", "");
      return handleRedirect(slug, env);
    }

    return new Response("Shelinq Worker is running!");
  }
};

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
    // Overwrite the same R2 key so the slug/QR code never has to change
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