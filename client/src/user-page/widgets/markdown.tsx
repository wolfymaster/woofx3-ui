import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { imageUrl, linkUrl } from "../urls";

/**
 * Owner-written Markdown, rendered without any HTML it contains (`skipHtml`)
 * and with links and images held to the page's URL rules, since a visitor
 * reads it on this origin.
 */
const components: Components = {
  a: ({ href, children }) => {
    const safe = href === undefined ? null : linkUrl(href);
    if (safe === null) {
      return <span>{children}</span>;
    }
    return (
      <a href={safe} target="_blank" rel="noopener noreferrer nofollow ugc">
        {children}
      </a>
    );
  },
  img: ({ src, alt }) => {
    const safe = typeof src === "string" ? imageUrl(src) : null;
    if (safe === null) {
      return null;
    }
    return <img src={safe} alt={alt ?? ""} loading="lazy" decoding="async" referrerPolicy="no-referrer" />;
  },
};

export default function PageMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="prose prose-neutral max-w-none dark:prose-invert prose-a:text-ink prose-a:decoration-accent prose-a:decoration-2 prose-a:underline-offset-4">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {markdown}
      </Markdown>
    </div>
  );
}
