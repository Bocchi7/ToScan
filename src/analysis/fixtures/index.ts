import type { AnalysisInput, Material } from '../contracts.ts';
import materials from './illustration-license/materials.json' with { type: 'json' };
import completeInput from './illustration-license/input.json' with { type: 'json' };
import missingInput from './illustration-license/input-missing.json' with { type: 'json' };
import completeAnswer from './illustration-license/mock-answer.json' with { type: 'json' };
import missingAnswer from './illustration-license/mock-answer-missing.json' with { type: 'json' };
import expectations from './illustration-license/expectations.json' with { type: 'json' };

export type FixtureName = 'complete' | 'missing';

/** IDs in fixture input files reference materials.json, not production HTTP fields. */
export function loadFixture(name: FixtureName) {
  const source = name === 'complete' ? completeInput : missingInput;
  const byId = new Map<string, Material>(materials.map(material => [material.document.id, material]));
  const getMaterial = (id: string): Material => {
    const material = byId.get(id);
    if (!material) throw new Error(`Unknown fixture material: ${id}`);
    return structuredClone(material);
  };
  const input: AnalysisInput = {
    question: source.question,
    history: structuredClone(source.history),
    knownMaterials: source.knownMaterialIds.map(getMaterial),
    seedResults: source.seedMaterialIds.map(id => ({ ok: true, material: getMaterial(id) })),
  };
  return {
    input,
    mockOutput: JSON.stringify(name === 'complete' ? completeAnswer : missingAnswer),
    expectations: structuredClone(expectations[name]),
  };
}
