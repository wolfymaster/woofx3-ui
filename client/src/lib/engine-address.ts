/**
 * The address to show for a managed engine. `publicUrl` is where the engine is
 * served from and never changes, even after a rename, so the name in it can be
 * an old one; every name the engine has held answers on the same domain.
 */
export function engineAddress(publicUrl: string | undefined, slug: string): string | null {
  if (!publicUrl) {
    return null;
  }
  const url = new URL(publicUrl);
  return `${url.protocol}//${slug}${url.host.slice(url.host.indexOf("."))}`;
}
