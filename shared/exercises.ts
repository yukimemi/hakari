// The exercise catalogue the trainer avatar can actually demonstrate.
//
// This list is the contract between three places:
//   1. the LLM, which may only return ids from here (a plan naming a
//      motion we cannot show would leave the avatar standing idle),
//   2. `src/avatar/procedural.ts`, which drives the VRM humanoid bones
//      for each id,
//   3. `src/avatar/gesture.ts`, which prefers a Mixamo .fbx clip when the
//      user has dropped one into `public/motions/` — Mixamo assets cannot
//      be redistributed, so the procedural fallback is what ships.
//
// Equipment is deliberately limited to what someone has at home.

export type Equipment = "none" | "mat" | "dumbbell" | "chair";

export type MuscleGroup =
  | "legs"
  | "glutes"
  | "core"
  | "chest"
  | "back"
  | "shoulders"
  | "arms"
  | "cardio";

export type ExerciseDef = {
  id: string;
  name: string;
  groups: MuscleGroup[];
  equipment: Equipment;
  /** Rough METs, used for the calorie-burn estimate. */
  mets: number;
  /** Filename under `public/motions/` if the user supplies a Mixamo clip. */
  clip?: string;
  /** Shown under the avatar while it demonstrates. */
  cue: string;
  /**
   * How to name the movement to a video model, in English.
   *
   * Not the id: "plank" produced a man at the top of a push-up, because in
   * English that is a plank too. The Japanese word means the one on the
   * elbows. Each of these says which variant unambiguously and nothing
   * else — long prompts get caught by Veo's filter.
   */
  english: string;
};

export const EXERCISES: ExerciseDef[] = [
  {
    id: "squat",
    name: "スクワット",
    groups: ["legs", "glutes"],
    equipment: "none",
    mets: 5.0,
    clip: "squat.fbx",
    cue: "膝がつま先より前に出ないよう、お尻を後ろに引いて下ろす",
    english: "a bodyweight squat, standing up and squatting down",
  },
  {
    id: "pushup",
    name: "腕立て伏せ",
    groups: ["chest", "arms", "core"],
    equipment: "mat",
    mets: 3.8,
    clip: "pushup.fbx",
    cue: "体を一直線に保ち、肘は45度に開く。腰を落とさない",
    english: "a push-up on hands and toes",
  },
  {
    id: "knee-pushup",
    name: "膝つき腕立て",
    groups: ["chest", "arms"],
    equipment: "mat",
    mets: 3.0,
    cue: "膝から頭までを一直線に。まずはここから始めて問題ない",
    english: "a push-up with knees on the floor",
  },
  {
    id: "plank",
    name: "プランク",
    groups: ["core"],
    equipment: "mat",
    mets: 3.3,
    clip: "plank.fbx",
    cue: "肘は肩の真下。お尻を上げすぎず、お腹に力を入れ続ける",
    english: "a forearm plank, resting on the elbows, body straight",
  },
  {
    id: "side-plank",
    name: "サイドプランク",
    groups: ["core"],
    equipment: "mat",
    mets: 3.3,
    cue: "肩・腰・足首を一直線に。腰が落ちたらそこで終了",
    english: "a side plank on one forearm, hips lifted",
  },
  {
    id: "lunge",
    name: "ランジ",
    groups: ["legs", "glutes"],
    equipment: "none",
    mets: 4.0,
    cue: "前の膝は90度まで。上体は真っすぐ、視線は前",
    english: "a forward lunge, alternating legs",
  },
  {
    id: "glute-bridge",
    name: "ヒップリフト",
    groups: ["glutes", "core"],
    equipment: "mat",
    mets: 3.0,
    cue: "かかとで床を押し、お尻を締めて持ち上げる。反り腰にしない",
    english: "a glute bridge, lying on the back and lifting the hips",
  },
  {
    id: "crunch",
    name: "クランチ",
    groups: ["core"],
    equipment: "mat",
    mets: 3.8,
    cue: "首ではなくお腹で上体を丸める。肩甲骨が浮く程度で十分",
    english: "an abdominal crunch, lying on the back",
  },
  {
    id: "dead-bug",
    name: "デッドバグ",
    groups: ["core"],
    equipment: "mat",
    mets: 3.0,
    cue: "腰と床の隙間をなくしたまま、対角の手足をゆっくり伸ばす",
    english: "a dead bug, lying on the back extending opposite arm and leg",
  },
  {
    id: "russian-twist",
    name: "ロシアンツイスト",
    groups: ["core"],
    equipment: "mat",
    mets: 4.0,
    cue: "背すじを伸ばしたまま、みぞおちから捻る",
    english: "a Russian twist, seated and rotating the torso",
  },
  {
    id: "jumping-jack",
    name: "ジャンピングジャック",
    groups: ["cardio", "legs"],
    equipment: "none",
    mets: 8.0,
    clip: "jumping-jack.fbx",
    cue: "着地は膝を軽く曲げて。マンションなら足踏みバージョンで",
    english: "jumping jacks",
  },
  {
    id: "high-knees",
    name: "もも上げ",
    groups: ["cardio", "legs", "core"],
    equipment: "none",
    mets: 8.0,
    cue: "太ももが床と平行になるまで。腕も大きく振る",
    english: "high knees running in place",
  },
  {
    id: "mountain-climber",
    name: "マウンテンクライマー",
    groups: ["cardio", "core"],
    equipment: "mat",
    mets: 8.0,
    cue: "肩が手首の真上。お尻を上下させずテンポよく",
    english: "mountain climbers in a push-up position",
  },
  {
    id: "burpee",
    name: "バーピー",
    groups: ["cardio", "legs", "chest"],
    equipment: "none",
    mets: 8.0,
    cue: "一番きつい種目。回数よりフォームを優先、無理なら省略可",
    english: "a burpee",
  },
  {
    id: "calf-raise",
    name: "カーフレイズ",
    groups: ["legs"],
    equipment: "none",
    mets: 2.8,
    cue: "つま先立ちで1秒止める。壁に手をついてよい",
    english: "standing calf raises, rising onto the toes",
  },
  {
    id: "superman",
    name: "バックエクステンション",
    groups: ["back", "glutes"],
    equipment: "mat",
    mets: 3.0,
    cue: "反らせすぎない。胸が少し浮く程度で背中に効く",
    english: "a superman back extension, lying face down lifting arms and legs",
  },
  {
    id: "chair-dip",
    name: "椅子ディップス",
    groups: ["arms", "chest"],
    equipment: "chair",
    mets: 3.5,
    cue: "肘を後ろに曲げる。肩がすくまないように",
    english: "a triceps dip using a chair behind the body",
  },
  {
    id: "dumbbell-row",
    name: "ダンベルロウ",
    groups: ["back", "arms"],
    equipment: "dumbbell",
    mets: 3.5,
    cue: "背中を丸めず、肘を後ろに引いて肩甲骨を寄せる",
    english: "a bent-over dumbbell row",
  },
  {
    id: "dumbbell-press",
    name: "ダンベルショルダープレス",
    groups: ["shoulders", "arms"],
    equipment: "dumbbell",
    mets: 3.5,
    cue: "肘を伸ばし切らない。腰を反らせないよう腹圧を保つ",
    english: "a standing dumbbell shoulder press",
  },
  {
    id: "walk",
    name: "早歩き",
    groups: ["cardio"],
    equipment: "none",
    mets: 4.3,
    cue: "会話はできるが歌えない程度のペースを維持する",
    english: "brisk walking",
  },
];

export const EXERCISE_BY_ID = new Map(EXERCISES.map((e) => [e.id, e]));

/** Compact catalogue text for the LLM prompt — ids plus enough context to
 *  pick sensibly, without spending tokens on the coaching cues. */
export function catalogueForPrompt(available: Equipment[]): string {
  return EXERCISES.filter((e) => available.includes(e.equipment))
    .map((e) => `${e.id}: ${e.name} (${e.groups.join("/")})`)
    .join("\n");
}
