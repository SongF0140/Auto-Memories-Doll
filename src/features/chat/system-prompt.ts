export type SystemBlocks = {
  systemPrefix: string;
  /** 第九块起恒为空串：自然语言不猜测操作意图，意图块已废弃 */
  intentBlock: string;
  memoryBlock: string;
  /**
   * I-5 控制面：截断版 index.md。
   * 成熟的知识系统不是有页面，而是有运行面板——模型进来的第一个导航点是 index。
   */
  controlPlaneBlock?: string;
  /**
   * 博客写作模板：每次调用都注入，定义知识分类段落与讲解排版格式；
   * 配合 memoryBlock 中按段落归位的知识素材使用。
   */
  blogTemplateBlock?: string;
};

export function assembleSystemMessage(blocks: SystemBlocks): string {
  const controlPlane = blocks.controlPlaneBlock ? `${blocks.controlPlaneBlock}\n\n` : "";
  const blogTemplate = blocks.blogTemplateBlock ? `${blocks.blogTemplateBlock}\n\n` : "";
  return `${blocks.systemPrefix}
${blocks.intentBlock}

${controlPlane}${blogTemplate}${blocks.memoryBlock}

你现在要以记忆伴侣的身份，根据以上信息为用户提供最贴心的回答。`;
}
