/** Parse namespace.name FQCN from an Ansible collection galaxy.yml. */
export function parseGalaxyCollectionFqcn(yaml: string): string | null {
  const ns = yaml.match(/^namespace:\s*(\S+)/m)?.[1]
  const name = yaml.match(/^name:\s*(\S+)/m)?.[1]
  if (!ns || !name) return null
  return `${ns}.${name}`
}
