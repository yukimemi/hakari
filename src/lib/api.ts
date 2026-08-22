// Typed client for the /api routes.
//
// Every call carries the Firebase ID token; the routes verify it before
// spending a single provider token, so an expired session fails fast and
// cheaply rather than after an image upload.

import { auth } from "./firebase";
import type {
  BodyAnalysis,
  CoachComment,
  MealAnalysis,
  TaskAssignment,
  WorkoutPlan,
} from "../../shared/schema";
import type { ProviderId } from "../../shared/providers";
import type { Equipment } from "../../shared/exercises";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function idToken(): Promise<string> {
  const user = auth().currentUser;
  if (!user) throw new ApiError("ログインが必要です", 401);
  return user.getIdToken();
}

async function call<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<T> {
  const token = await idToken();
  const res = await fetch(path, {
    method: init.method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const text = await res.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(
      `サーバから予期しない応答を受け取りました (HTTP ${res.status})`,
      res.status,
    );
  }

  if (!res.ok) {
    const message =
      (payload as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new ApiError(message, res.status);
  }
  return payload as T;
}

export type EncodedImage = {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
};

export type ProviderStatus = {
  id: ProviderId;
  label: string;
  configured: boolean;
  vision: boolean;
  docsUrl: string;
  defaultModel: string;
};

export type ModelInfo = { id: string; label: string; vision?: boolean };

export const api = {
  providers(): Promise<{ providers: ProviderStatus[] }> {
    return call("/api/models", { method: "GET" });
  },

  models(provider: ProviderId): Promise<{ models: ModelInfo[] }> {
    return call(`/api/models?provider=${encodeURIComponent(provider)}`, {
      method: "GET",
    });
  },

  analyzeMeal(args: {
    image: EncodedImage;
    assignment: TaskAssignment;
    hint?: string;
  }): Promise<{ analysis: MealAnalysis; provider: ProviderId; model: string }> {
    return call("/api/analyze-meal", {
      method: "POST",
      body: {
        imageBase64: args.image.base64,
        mediaType: args.image.mediaType,
        provider: args.assignment.provider,
        model: args.assignment.model,
        hint: args.hint,
      },
    });
  },

  analyzeBody(args: {
    image: EncodedImage;
    assignment: TaskAssignment;
    heightCm: number;
    weightKg: number;
    sex: "male" | "female";
    age: number;
    measurements?: Record<string, number>;
    note?: string;
  }): Promise<{ analysis: BodyAnalysis; provider: ProviderId; model: string }> {
    const { image, assignment, ...rest } = args;
    return call("/api/analyze-body", {
      method: "POST",
      body: {
        imageBase64: image.base64,
        mediaType: image.mediaType,
        provider: assignment.provider,
        model: assignment.model,
        ...rest,
      },
    });
  },

  workoutPlan(args: {
    assignment: TaskAssignment;
    heightCm: number;
    weightKg: number;
    targetWeightKg: number;
    sex: "male" | "female";
    age: number;
    equipment: Equipment[];
    minutesPerSession: number;
    daysPerWeek: number;
    focusAreas?: string[];
    bodyType?: string;
    constraints?: string;
    experience: "beginner" | "intermediate" | "advanced";
  }): Promise<{ plan: WorkoutPlan; provider: ProviderId; model: string }> {
    const { assignment, ...rest } = args;
    return call("/api/workout-plan", {
      method: "POST",
      body: { provider: assignment.provider, model: assignment.model, ...rest },
    });
  },

  coach(args: {
    assignment: TaskAssignment;
    recentDays: {
      date: string;
      weightKg?: number;
      intakeKcal: number;
      burnedKcal: number;
      tdee: number;
      proteinG?: number;
      fatG?: number;
      carbsG?: number;
    }[];
    targetWeightKg: number;
    targetDate: string;
    requiredDailyDeficit: number;
    localTime: string;
    loggedSlots: string[];
    today: string;
    proteinTargetG?: number;
  }): Promise<{ comment: CoachComment; provider: ProviderId; model: string }> {
    const { assignment, ...rest } = args;
    return call("/api/coach", {
      method: "POST",
      body: { provider: assignment.provider, model: assignment.model, ...rest },
    });
  },
};
