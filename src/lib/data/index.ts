/**
 * 画面から使うデータの読み書き。読み取りは react-query でまとめ、書き込み後に再取得する。
 * RLS により、ここで読めるのは本人のデータだけ。
 *
 * - rows：DB の行の形と、計算（@domain）の形への詰め替え
 * - vehicles：車両・プラン・期限と、表示している1台の記録の読み込み
 * - records：記録（オイル交換・支出・タイヤ／ブレーキ・走行距離）の書き込み
 * - photos／certificate／recurring／shops／metrics：それぞれの機能の読み書き
 */
export * from './rows';
export * from './vehicles';
export * from './records';
export * from './photos';
export * from './certificate';
export * from './recurring';
export * from './shops';
export * from './metrics';
