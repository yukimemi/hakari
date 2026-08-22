# hakari — 秤

写真を撮るだけで食事のカロリーが記録され、体型の変化が 3D で見え、
その体型に合ったトレーニングを 3D のトレーナーが実演する、
ダイエット記録アプリ。

Vite + React + TypeScript + Tailwind の SPA、認証とデータは Firebase、
AI 呼び出しは Vercel Functions 経由。

## できること

| 画面 | 内容 |
| --- | --- |
| 今日 | 竿秤の指針で目標までの距離、今日のカロリー収支、AI コーチの一言 |
| 食事 | 料理の写真 → 品目・分量・kcal・PFC を推定。数値は保存前に手で直せる |
| 体重 | 実測と 7 日移動平均のグラフ、目標線、到達日の予測 |
| からだ | 全身写真 → 骨格とシルエットを実測 → 体型を 3D 表示。スライダーで目標体重の姿へモーフ |
| 鍛える | 体型・目標・器具から 1 週間のメニューを生成。種目を選ぶとアバターが実演し、音声でコツを読み上げる |

## AI プロバイダ

5 つのプロバイダに対応し、**タスクごとに別のプロバイダを割り当てられる**。

| プロバイダ | 画像 | 用途の目安 |
| --- | --- | --- |
| Claude (Anthropic) | ○ | 写真の分量推定が最も安定 |
| OpenAI | ○ | 汎用 |
| Gemini (Google) | ○ | 無料枠が大きい。毎食の解析を安く回す |
| OpenRouter | モデル次第 | 1 キーで各社のモデルを切替 |
| DeepSeek | vision-exp のみ | 非常に安い。メニュー生成とコーチ向き |

モデル ID はハードコードしていない。設定画面が各プロバイダの
`GET /v1/models` を叩いて実在するモデルを一覧するので、新しいモデルが出れば
そのまま選べる。

写真解析には画像対応のプロバイダが必要。DeepSeek は 2026-08-21 に
`deepseek-v4-flash-vision-exp` で画像入力に対応したが、**その 1 モデルだけ**なので、
設定画面の写真タスクでは vision 対応モデルに絞って表示する。モデルを指定せずに
写真タスクへ割り当てた場合は vision-exp が自動で使われる。

## セットアップ

```sh
pnpm install
cp .env.example .env
```

**`.env` はリポジトリに入っていない** (`.gitignore` 済み)。`.env.example` は
空の雛形なので、自分の Firebase プロジェクトの値を入れる。

### 1. Firebase

プロジェクトを作り、Firestore と Storage を用意する。gcloud だけで一通り
作れる (手順は [作り直す場合](#作り直す場合) を参照)。ウェブアプリを登録して
構成値を `.env` の `VITE_FIREBASE_*` と `FIREBASE_PROJECT_ID` に入れる。

これらは**ブラウザに埋め込まれる前提の公開値**で、秘密ではない。守っているのは
`firestore.rules` と `storage.rules` であって、この値を隠すことではない。

続けて、ルールを反映する:

```sh
pnpm exec firebase deploy --only firestore:rules,storage
```

**コンソールでの作業が 1 つだけ残る** — Authentication → Sign-in method →
**Google を有効化**。OAuth クライアントの発行を伴うため、ここだけ CLI / API で
完結しない。有効化すると `localhost` は自動で承認済みドメインに入る。
本番ドメインは自分で追加する。

### 2. アクセスできる人を決める

`shared/access.ts` の `OWNER_EMAIL` を自分の Google アカウントにする。
同じアドレスを `firestore.rules` と `storage.rules` にも書く (ルールは
コードを読めないので、3 箇所を手で揃える)。詳しくは
[アクセス制御](#アクセス制御)。

### 3. AI のキー

最低 1 つ。`.env` に書いてもいいし、シェルで export してもいい —
**既にシェルにあるものが優先される** (dotenv と同じ規則)。

```
ANTHROPIC_API_KEY=...    # 写真の分量推定が最も安定
GEMINI_API_KEY=...       # 無料枠が大きい
OPENAI_API_KEY=...
OPENROUTER_API_KEY=...   # 実測では一番速かった
DEEPSEEK_API_KEY=...     # 安い。ただし出力が大きい処理は遅い
```

このリポジトリの持ち主は `.env` に書かず、シェルのプロファイルから
export している (鍵の置き場所を増やさないため)。どちらでも動く。

本番 (Vercel) では同じ名前をプロジェクトの環境変数に登録する。
**キーはサーバ側だけで使われ、ブラウザには渡らない。**

任意の調整:

| 変数 | 既定 | 用途 |
| --- | --- | --- |
| `DAILY_CALL_LIMIT` | 60 | 1 ユーザー 1 日あたりの AI 呼び出し上限 |
| `PROVIDER_TIMEOUT_MS` | 280000 | プロバイダ 1 回の待ち上限。`vercel.json` の `maxDuration` より内側にすること |
| `<PROVIDER>_MODEL` | — | 既定モデルの上書き。設定画面での選択が優先される |

### 起動

```sh
pnpm install
pnpm dev
```

`/api/*` も dev サーバが処理する (`vite-plugin-api.ts`)。本番では同じ
ファイルが Vercel Functions になるので、ローカルに Vercel CLI は要らない。

## アクセス制御

公開 URL なので、**Google アカウントを持っているだけでは入れない**。
持ち主 (`OWNER_EMAIL`, `shared/access.ts`) は常に許可され、それ以外は
Firestore の `config/access.allowedEmails` に載っているアドレスだけ。
リストは設定画面の「招待」から編集する (デプロイ不要)。

三箇所で効いている:

| どこ | 何を守る |
| --- | --- |
| `firestore.rules` / `storage.rules` | 記録と写真そのもの |
| `api/_lib/auth.ts` (`requireUser`) | AI キーの消費 |
| `src/App.tsx` の `InviteGate` | 表示メッセージだけ (権限は与えない) |

## 使いすぎの歯止め

AI を呼ぶルートは 1 回ごとに `users/{uid}/usage/{yyyy-MM-dd}.calls` を数え、
1 日 60 回 (`DAILY_CALL_LIMIT` で変更可) を超えると 429 を返す。日付は
Asia/Tokyo で切る (Vercel は UTC で動くため)。

カウンタは**呼び出し元自身のトークンで**書くので、ブラウザからも同じ
ドキュメントに手が届いてしまう。そこで上限を成立させているのは
セキュリティルールの方:

```
allow create: if ... request.resource.data.calls == 1;
allow update: if ... request.resource.data.calls == resource.data.calls + 1;
allow delete: if false;
```

1 ずつしか増えず、消せない。**`match /{collection}/{document}` から usage を
除外している**のが要点で、ルールは OR で評価されるため、除外を忘れると
一般規則の write が上の制限を丸ごと打ち消す。

サーバ側は招待判定を 60 秒キャッシュするので、取り消しが API に効くまで
最大 1 分かかる。持ち主のアドレスを変えるときは `shared/access.ts` と
両方の rules を揃えること。

### 公開

<https://hakari-two.vercel.app> (Vercel, 東京リージョン)。

```sh
pnpm dlx vercel@latest deploy --prod
```

環境変数は Vercel のプロジェクト設定に入っている (`vercel env ls`)。
新しいドメインを足したら Firebase の承認済みドメインにも追加すること
(でないと Google サインインが弾かれる)。

**API ルートを足すときの作法** — Vercel の Node ランタイムは
`export default` を `(req, res) => void` と解釈して戻り値を捨てる。
Web の `Request`/`Response` を使うには**メソッド名で named export** する:

```ts
export const POST = route(async (request) => { ... });
```

相対 import には `.js` を付ける (`./_lib/http.js`)。バンドルされずに
Node ESM がそのまま解決するため。TypeScript も Vite も `.js` を `.ts` に
読み替えるので、ブラウザ側のビルドには影響しない。

### 作り直す場合

```sh
gcloud projects create <id> --name=hakari
gcloud services enable firebase.googleapis.com identitytoolkit.googleapis.com   firestore.googleapis.com firebaserules.googleapis.com firebasestorage.googleapis.com --project=<id>
gcloud firestore databases create --location=asia-northeast1 --type=firestore-native --project=<id>
```

Firebase の有効化・ウェブアプリ登録・ルール反映は Management API を
`gcloud auth print-access-token` + `X-Goog-User-Project` ヘッダで叩く。
Storage の既定バケットは請求先アカウントのリンクが要る。

## アバター

既定のトレーナーは **アリシア・ソリッド** (VRM 0.51, 約 7.9MB)。**リポジトリには入っていない** —
公開リポジトリに他人のモデルを同梱するのは再配布になるため、必要なときに落とす:

```sh
pnpm run avatar
```

取得元は VRM Consortium の [UniVRM](https://github.com/vrm-c/UniVRM) に
テストモデルとして同梱されているもの（ニコニ立体の配布ページはログインが要るため）。
未取得でも自作マネキンにフォールバックするので、動作はする。

利用条件は[公式](https://3d.nicovideo.jp/alicia/rule.html)を参照。**無料・クレジット表記不要・
改変可・商用利用可（法人を除く）** とされている。差し替えるときは同じパスに置くか、
設定画面の「アバター」でパスや URL を指定する。未指定・読み込み失敗時は
カプセル製のマネキン (`src/avatar/mannequin.ts`) にフォールバックする。

**座標系の約束**: `procedural.ts` のキーフレームは **VRM 0.x の空間**
（正面 −Z、キャラの左が −X）で書かれている。マネキンも同じ空間で組み、
`VRMUtils.rotateVRM0` と同じ半回転でカメラ側を向かせている。VRM 1.0 の
モデルは正面 +Z なので、左右が鏡像になる可能性がある。
`AvatarStage` が毎フレーム触るのは `rotation.x` だけ — 3 軸まとめて書くと
この半回転を消してしまう。

体型はボーンの太さ（X/Z スケール）だけを変え、身長と手足の長さは動かさない。
子ボーンには逆スケールを掛けているので、胴を太くしても腕が伸びない。

トレーニングの動きはコードで定義したキーフレームで動く（`src/avatar/procedural.ts`）。
Mixamo の FBX を `public/motions/` に置けばそちらが優先される。

## 構成

```
api/                 Vercel Functions
  _lib/providers.ts  5 プロバイダを 1 つの complete() に集約
  _lib/auth.ts       Firebase ID トークン検証 (jose、firebase-admin 不使用)
  analyze-meal.ts    食事写真 → カロリー
  analyze-body.ts    全身写真 + 実測値 → 体型パラメータ
  workout-plan.ts    メニュー生成 (種目は必ずカタログ内に制限)
  coach.ts           日々のコメント
  models.ts          プロバイダのモデル一覧

shared/              ブラウザと API の両方が使う
  schema.ts          zod スキーマ (Firestore の形と LLM の出力形)
  calc.ts            BMR / TDEE / ペース / 移動平均 / 傾き
  exercises.ts       アバターが実演できる種目カタログ
  providers.ts       プロバイダとタスクの定義

src/
  avatar/            three.js + VRM、体型変形、手続きモーション、マネキン
  vision/measure.ts  MediaPipe で骨格とシルエットを実測
  components/        UI プリミティブと竿秤ゲージ
  data/              Firestore アクセスと購読フック
  pages/             各画面
```

## テスト

```sh
pnpm test
```

計算層（`shared/calc.ts`）と体型・モーション（`src/avatar/`）を対象にしている。

## 精度について

写真からのカロリー推定は**推定**であり、実測ではない。分量が読み取りにくい
品目には信頼度が付き、数値は保存前にすべて手で直せる。
体型の 3D も同様に、絶対値ではなく変化の方向を見るためのもの。

## License

MIT.
