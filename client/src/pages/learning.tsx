import { useEffect } from "react";
import { Link } from "wouter";
import { glossaryAnchor } from "@/components/common/help-tip";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GLOSSARY, GLOSSARY_CATEGORY_LABELS, type GlossaryCategory, type GlossaryKey } from "@/lib/glossary";
import { cn } from "@/lib/utils";

const CATEGORY_ORDER: GlossaryCategory[] = ["setup", "automation", "overlays", "dashboard"];

const TERMS = Object.keys(GLOSSARY) as GlossaryKey[];

export default function Learning() {
  // A HelpTip links here with the term's anchor. The page is lazy-loaded, so
  // the browser's own jump to the hash happens before the entry exists.
  const highlighted = window.location.hash.slice(1);
  useEffect(() => {
    if (!highlighted) {
      return;
    }
    document.getElementById(highlighted)?.scrollIntoView({ block: "center" });
  }, [highlighted]);

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <PageHeader title="Learning" description="What the words around woofx3 mean, and where to find each thing." />

      <div className="space-y-6">
        {CATEGORY_ORDER.map((category) => {
          const terms = TERMS.filter((key) => GLOSSARY[key].category === category);
          if (terms.length === 0) {
            return null;
          }
          return (
            <Card key={category}>
              <CardHeader>
                <CardTitle className="text-base">{GLOSSARY_CATEGORY_LABELS[category]}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-4">
                  {terms.map((key) => {
                    const entry = GLOSSARY[key];
                    const anchor = glossaryAnchor(key);
                    return (
                      <div
                        key={key}
                        id={anchor}
                        className={cn("scroll-mt-24 rounded-md -mx-2 px-2 py-1", highlighted === anchor && "bg-accent")}
                        data-testid={`glossary-${key}`}
                      >
                        <dt className="font-medium">{entry.term}</dt>
                        <dd className="text-sm text-muted-foreground">
                          {entry.definition}{" "}
                          {entry.href && (
                            <Link href={entry.href} className="text-primary hover:underline whitespace-nowrap">
                              Go there
                            </Link>
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
