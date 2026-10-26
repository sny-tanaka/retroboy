// plugins/builtinGames.ts が作る、内蔵ソフトの目録
declare module "virtual:builtin-games" {
    const games: readonly import("./builtinGame").BuiltinGame[];
    export default games;
}
