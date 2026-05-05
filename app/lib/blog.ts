import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkHtml from "remark-html";
import readingTime from "reading-time";

export interface PostMetadata {
  slug: string;
  title: string;
  description: string;
  date: string;
  author: string;
  category: string;
  keywords: string[];
  image?: string;
  readingTime: string;
}

export interface Post {
  metadata: PostMetadata;
  contentHtml: string;
}

const BLOG_DIR = path.join(process.cwd(), "content", "blog");

interface RawFrontmatter {
  title?: unknown;
  description?: unknown;
  date?: unknown;
  author?: unknown;
  category?: unknown;
  keywords?: unknown;
  image?: unknown;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

async function readMarkdownFiles(): Promise<string[]> {
  try {
    const entries = await fs.readdir(BLOG_DIR);
    return entries.filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
}

function buildMetadata(slug: string, data: RawFrontmatter, content: string): PostMetadata {
  const stats = readingTime(content, { wordsPerMinute: 200 });
  const minutes = Math.max(1, Math.round(stats.minutes));
  return {
    slug,
    title: asString(data.title, slug),
    description: asString(data.description),
    date: asString(data.date),
    author: asString(data.author, "Confeccione"),
    category: asString(data.category, "Geral"),
    keywords: asStringArray(data.keywords),
    image: typeof data.image === "string" ? data.image : undefined,
    readingTime: `${minutes} min de leitura`,
  };
}

export async function getAllSlugs(): Promise<string[]> {
  const files = await readMarkdownFiles();
  return files.map((f) => f.replace(/\.md$/, ""));
}

export async function getAllPosts(): Promise<PostMetadata[]> {
  const files = await readMarkdownFiles();
  const posts = await Promise.all(
    files.map(async (file) => {
      const slug = file.replace(/\.md$/, "");
      const raw = await fs.readFile(path.join(BLOG_DIR, file), "utf8");
      const { data, content } = matter(raw);
      return buildMetadata(slug, data as RawFrontmatter, content);
    }),
  );
  return posts.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
  const filePath = path.join(BLOG_DIR, `${slug}.md`);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
  const { data, content } = matter(raw);
  const processed = await remark().use(remarkGfm).use(remarkHtml).process(content);
  return {
    metadata: buildMetadata(slug, data as RawFrontmatter, content),
    contentHtml: processed.toString(),
  };
}
