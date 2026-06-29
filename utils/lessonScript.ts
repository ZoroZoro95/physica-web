import { Chapter } from "@/components/SceneViewer";

// Extend the base Chapter type with optional chalkboard fields from the backend schema
export interface ChapterWithMath extends Chapter {
  formula?: string;
  derivation?: string;
}

export interface LessonScene {
  focusId: string | null;
  focusLabel: string;
  formula: string;
  derivation: string;
  textStory: string;
  tutorScript: string;
}

function isProjectileChapter(chapter: Chapter) {
  const text = `${chapter.title} ${chapter.narration}`.toLowerCase();
  return text.includes("projectile") || text.includes("launch") || text.includes("velocity") || text.includes("gravity");
}

function isDecompositionChapter(chapter: Chapter) {
  const text = `${chapter.title} ${chapter.narration}`.toLowerCase();
  return text.includes("decomposition") || text.includes("component") || text.includes("angle");
}

function isResultChapter(chapter: Chapter) {
  const title = chapter.title.toLowerCase();
  return title.includes("result") || title.includes("range") || title.includes("flight");
}

export function getFocusId(chapter: Chapter | undefined): string | null {
  if (!chapter) return null;
  const visible = chapter.objects.filter(o => o.visible !== false);
  const projectile = visible.find(o =>
    o.physics_intent?.type === "projectile" ||
    (o.type === "sphere" && Array.isArray(o.path) && o.path.length > 1) ||
    /ball|projectile|mass/i.test(o.id)
  );
  if (projectile) return projectile.id;

  const vector = visible.find(o => /velocity|vector|arrow|angle|vx|vy/i.test(`${o.id} ${o.label ?? ""}`));
  if (vector) return vector.id;

  return visible.find(o => !["plane", "axes"].includes(o.type))?.id ?? null;
}

export function buildLessonScene(chapter: Chapter, index: number): LessonScene {
  // Cast to ChapterWithMath to access optional backend fields without type errors
  const ch = chapter as ChapterWithMath;
  const focusId = getFocusId(chapter);
  const focusLabel = focusId ? focusId.replace(/[_-]/g, " ") : "the highlighted object";
  const title = chapter.title || `Scene ${index + 1}`;
  const base = chapter.narration.trim();

  // Use backend-provided formula/derivation directly when available (dynamic scene generator)
  let formula = ch.formula || "idea -> identify what is given -> connect it to what is changing -> solve one relation at a time";
  let derivation = ch.derivation || "The key move is to translate the picture into quantities: what stays fixed, what changes, and what relation connects them.";

  // Only apply heuristic fallbacks when backend did NOT provide formula/derivation
  if (!ch.formula) {
    if (isProjectileChapter(chapter)) {
      formula = "vx = v0 cos(theta), vy = v0 sin(theta), x = vx t, y = h + vy t - (1/2)gt^2";
      derivation = "Split the launch velocity into horizontal and vertical parts. Horizontal motion keeps the same velocity, while vertical motion changes because gravity subtracts gt from the upward velocity.";
    }

    if (isDecompositionChapter(chapter)) {
      formula = "vx = v0 cos(theta), vy = v0 sin(theta)";
      derivation = "The angle tells us how much of the launch speed points sideways and how much points upward. Cosine takes the adjacent horizontal part; sine takes the opposite vertical part.";
    }

    if (isResultChapter(chapter)) {
      formula = "set y = 0 to find flight time, then range = vx * T";
      derivation = "Landing happens when the vertical position returns to the ground. Once that time is known, the horizontal distance is just constant horizontal speed multiplied by time.";
    }
  }

  const textStory = [
    `Scene ${index + 1}: ${title}.`,
    `Start with the picture, not the equation. ${base}`,
    `Keep your eyes on ${focusLabel}. That is the visual anchor for this step. The algebra should feel like a written version of what the animation is already showing.`,
    `Formula: ${formula}.`,
    `Why this works: ${derivation}`,
    "Before moving on, replay the scene once and check that the motion, the highlighted object, and the formula are all telling the same story."
  ].join("\n\n");

  const visualQuestion = isProjectileChapter(chapter)
    ? `Look at the scene first. Do you see the launch angle and the path of ${focusLabel}?`
    : `Look at the scene first. Do you see ${focusLabel} and how it changes?`;

  const tutorScript = [
    visualQuestion,
    `Good. Here is the idea. ${base}`,
    `Now I am putting the formula on the board: ${formula}.`,
    derivation,
    `Watch ${focusLabel} while you hear this. The highlighted part is the quantity we are tracking, so the animation and the equation stay connected.`
  ].join(" ");

  return { focusId, focusLabel, formula, derivation, textStory, tutorScript };
}