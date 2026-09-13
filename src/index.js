export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/books/upload" && request.method === "POST") {
      return handleUpload(request, env, url);
    }

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