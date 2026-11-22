export const DEFAULT_BRIDGE_PORT = 38451;
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export type BridgeMethod =
  | 'get_status'
  | 'get_selection'
  | 'get_node'
  | 'export_node_image'
  | 'get_local_tokens';

export interface GetSelectionParams {
  depth?: number;
  includeHidden?: boolean;
}

export interface GetNodeParams {
  nodeId: string;
  depth?: number;
  includeHidden?: boolean;
}

export interface ExportNodeImageParams {
  nodeId?: string;
  format?: 'PNG' | 'SVG';
  scale?: number;
}

export interface BridgeRequest {
  id: string;
  method: BridgeMethod;
  params?: Record<string, unknown>;
}

export interface BridgeErrorPayload {
  code: string;
  message: string;
}

export type BridgeResponse<T = unknown> =
  | {
      id: string;
      ok: true;
      result: T;
    }
  | {
      id: string;
      ok: false;
      error: BridgeErrorPayload;
    };

export interface SerializedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SerializedPaint {
  type: string;
  visible?: boolean;
  opacity?: number;
  color?: string;
  gradientStops?: Array<{ position: number; color: string }>;
  scaleMode?: string;
  imageHash?: string;
}

export interface SerializedEffect {
  type: string;
  visible?: boolean;
  radius?: number;
  spread?: number;
  offset?: { x: number; y: number };
  color?: string;
}

export interface SerializedTextStyle {
  characters: string;
  fontFamily?: string | 'MIXED';
  fontStyle?: string | 'MIXED';
  fontSize?: number | 'MIXED';
  lineHeight?: string | 'MIXED';
  letterSpacing?: string | 'MIXED';
  textAlignHorizontal?: string;
  textAlignVertical?: string;
  textDecoration?: string | 'MIXED';
  textCase?: string | 'MIXED';
}

export interface SerializedLayout {
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID';
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  layoutWrap?: string;
  itemSpacing?: number;
  counterAxisSpacing?: number;
  padding?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  sizingHorizontal?: string;
  sizingVertical?: string;
}

export interface SerializedCornerRadius {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

export interface SerializedNode {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  opacity?: number;
  bounds?: SerializedRect;
  cornerRadius?: number | SerializedCornerRadius | 'MIXED';
  fills?: SerializedPaint[] | 'MIXED';
  strokes?: SerializedPaint[] | 'MIXED';
  strokeWeight?: number | 'MIXED';
  effects?: SerializedEffect[];
  layout?: SerializedLayout;
  text?: SerializedTextStyle;
  componentId?: string;
  children?: SerializedNode[];
  truncatedChildrenCount?: number;
}

export interface BridgeStatus {
  connected: boolean;
  port?: number;
  fileName: string | null;
  pageName: string | null;
  selectionCount: number;
  selection?: Array<{ id: string; name: string; type: string }>;
}

export interface SelectionResult {
  pageName: string;
  selectionCount: number;
  nodes: SerializedNode[];
}

export interface NodeResult {
  node: SerializedNode;
}

export interface ExportedImage {
  nodeId: string;
  nodeName: string;
  format: 'PNG' | 'SVG';
  mimeType: 'image/png' | 'image/svg+xml';
  scale: number;
  width?: number;
  height?: number;
  data: string;
}

export interface SerializedPaintStyle {
  id: string;
  name: string;
  description?: string;
  paints: SerializedPaint[];
}

export interface SerializedTextStyleToken {
  id: string;
  name: string;
  description?: string;
  fontFamily: string;
  fontStyle: string;
  fontSize: number;
  lineHeight: string;
  letterSpacing: string;
}

export interface SerializedEffectStyle {
  id: string;
  name: string;
  description?: string;
  effects: SerializedEffect[];
}

export interface SerializedVariableCollection {
  id: string;
  name: string;
  defaultModeId: string;
  modes: Array<{ modeId: string; name: string }>;
}

export interface SerializedVariable {
  id: string;
  name: string;
  description?: string;
  collectionId: string;
  resolvedType: string;
  valuesByMode: Record<string, unknown>;
}

export interface SerializedTokens {
  paintStyles: SerializedPaintStyle[];
  textStyles: SerializedTextStyleToken[];
  effectStyles: SerializedEffectStyle[];
  variableCollections: SerializedVariableCollection[];
  variables: SerializedVariable[];
}
