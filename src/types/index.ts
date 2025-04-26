// 图标信息接口
export interface IconInfo {
  iconName: string;
  iconUnicode: string | undefined;
  ruleLine: number;
  contentLine: number;
}

// 内联图标悬停信息接口
export interface InlineIconHoverInfo {
  iconName: string;
  originalText: string;
  range: import('vscode').Range;
}

// 转换参数接口
export interface ConvertArgs {
  iconName: string;
  range: {
      startLine: number;
      startChar: number;
      endLine: number;
      endChar: number;
  };
}

// 全局状态接口
export interface GlobalState {
    // 存储图标类名到Unicode的映射，例如: 'icon-home' => 'e600'
    iconMap: Map<string, string>;
    
    // 存储图标ID到SVG路径内容的映射，例如: 'home' => '<path d="...">'
    svgPathMap: Map<string, string>;
    
    // Unicode到图标名称的反向映射，用于HTML实体查找，例如: 'e600' => 'icon-home'
    unicodeToIconNameMap: Map<string, string>;
    
    // CSS文件中装饰器类型的映射，用于显示图标在行号区域
    gutterIconDecorationTypes: Map<string, import('vscode').TextEditorDecorationType>;
    
    // 代码文件中内联装饰器类型的映射，用于在代码中显示图标
    inlineIconDecorationTypes: Map<string, import('vscode').TextEditorDecorationType>;
    
    // 存储CSS文件中每行对应的图标信息，用于右键菜单功能
    contentLineToIconInfoMap: Map<number, IconInfo>;
    
    // 存储代码中图标范围的信息，用于悬停提示
    decoratedRangeToIconInfoMap: Map<string, InlineIconHoverInfo>;
    
    // CSS文件中content属性的悬停提示装饰器
    hoverAnnotationDecorationType?: import('vscode').TextEditorDecorationType;
}