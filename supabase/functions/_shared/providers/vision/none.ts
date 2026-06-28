// vision/none.ts — sem descrição de imagem (modo offline sem multimodal / echo).
import { type Vision } from "../types.ts";

export const noneVision: Vision = {
  describe: () =>
    Promise.resolve("(imagem recebida — descrição indisponível neste modo; peça uma descrição em texto)"),
};
