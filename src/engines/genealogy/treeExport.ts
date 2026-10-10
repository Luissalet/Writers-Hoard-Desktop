// Exportadores puros del árbol genealógico: Graphviz DOT y texto jerárquico.
// Sin I/O y sin mutar la entrada; consumibles desde UI, CLI o pruebas.

type GenealogyLink = {
  id: string;
  fromId: string;
  toId: string;
  kind: string;
  label?: string;
};

type GenealogyInput = {
  characters: ReadonlyArray<{ id: string; name: string }>;
  links: ReadonlyArray<GenealogyLink>;
};

const PARENT_KINDS = new Set(['biological_parent', 'adoptive_parent', 'guardian']);

function escapeDot(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function kindLabel(link: GenealogyLink): string {
  return link.label ? `${link.kind}: ${link.label}` : link.kind;
}

function dotStyle(kind: string): string {
  if (kind === 'adoptive_parent' || kind === 'guardian') return ', style=dashed';
  if (kind === 'partner') return ', style=dotted';
  return '';
}

export function exportTreeDot(
  input: GenealogyInput,
  options: { name?: string } = {},
): string {
  const name = escapeDot(options.name ?? 'genealogy');
  const lines: string[] = [`digraph ${name} {`];
  for (const ch of input.characters) {
    lines.push(`  "${ch.id}" [label="${escapeDot(ch.name)}"]`);
  }
  for (const link of input.links) {
    lines.push(
      `  "${link.fromId}" -> "${link.toId}" [label="${escapeDot(kindLabel(link))}"${dotStyle(link.kind)}]`,
    );
  }
  lines.push('}');
  return lines.join('\n');
}

function relationSuffix(link: GenealogyLink): string {
  return ` (${kindLabel(link)})`;
}

export function exportTreeText(input: GenealogyInput): string {
  const nameById = new Map(input.characters.map((c) => [c.id, c.name]));
  const childLinks = new Map<string, GenealogyLink[]>();
  const hasParent = new Set<string>();
  const partnerNotes = new Map<string, GenealogyLink[]>();

  for (const link of input.links) {
    if (PARENT_KINDS.has(link.kind)) {
      const list = childLinks.get(link.fromId) ?? [];
      list.push(link);
      childLinks.set(link.fromId, list);
      hasParent.add(link.toId);
    } else if (link.kind === 'partner') {
      const list = partnerNotes.get(link.fromId) ?? [];
      list.push(link);
      partnerNotes.set(link.fromId, list);
    }
  }

  let roots = input.characters.filter((c) => !hasParent.has(c.id)).map((c) => c.id);
  if (roots.length === 0 && input.characters.length > 0) {
    // Ciclo sin raíces: partimos de todos para no perder personajes.
    roots = input.characters.map((c) => c.id);
  }

  const placed = new Set<string>();
  const lines: string[] = [];

  const emit = (id: string, depth: number, suffix: string) => {
    if (placed.has(id)) {
      // Ya está en el árbol: la relación extra se documenta como nota del padre.
      return false;
    }
    placed.add(id);
    const name = nameById.get(id) ?? id;
    lines.push(`${'  '.repeat(depth)}${name}${suffix}`);
    for (const link of childLinks.get(id) ?? []) {
      const nested = emit(link.toId, depth + 1, relationSuffix(link));
      if (!nested) {
        lines.push(
          `${'  '.repeat(depth + 1)}hijo: ${nameById.get(link.toId) ?? link.toId}${relationSuffix(link)}`,
        );
      }
    }
    for (const link of partnerNotes.get(id) ?? []) {
      lines.push(
        `${'  '.repeat(depth + 1)}pareja: ${nameById.get(link.toId) ?? link.toId}${relationSuffix(link)}`,
      );
    }
    return true;
  };

  for (const root of roots) emit(root, 0, '');

  return lines.join('\n');
}
