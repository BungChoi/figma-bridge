import type {
  SerializedCornerRadius,
  SerializedEffect,
  SerializedEffectStyle,
  SerializedLayout,
  SerializedNode,
  SerializedPaint,
  SerializedPaintStyle,
  SerializedRect,
  SerializedTextStyle,
  SerializedTextStyleToken,
  SerializedTokens,
  SerializedVariable,
  SerializedVariableCollection,
} from '@figma-bridge/shared';

function round(value: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function serializeColor(color: RGB | RGBA, opacityMultiplier = 1): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const baseAlpha = 'a' in color ? color.a : 1;
  const alpha = round(baseAlpha * opacityMultiplier, 3);

  if (alpha >= 0.999) {
    const toHex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function serializePaints(paints: readonly Paint[] | typeof figma.mixed): SerializedPaint[] | 'MIXED' {
  if (paints === figma.mixed) {
    return 'MIXED';
  }

  return paints.map((paint): SerializedPaint => {
    const base: SerializedPaint = {
      type: paint.type,
    };

    if (paint.visible === false) {
      base.visible = false;
    }
    if (paint.opacity !== undefined && paint.opacity < 0.999) {
      base.opacity = round(paint.opacity, 3);
    }

    if (paint.type === 'SOLID') {
      base.color = serializeColor(paint.color, paint.opacity ?? 1);
    } else if (
      paint.type === 'GRADIENT_LINEAR' ||
      paint.type === 'GRADIENT_RADIAL' ||
      paint.type === 'GRADIENT_ANGULAR' ||
      paint.type === 'GRADIENT_DIAMOND'
    ) {
      base.gradientStops = paint.gradientStops.map((stop) => ({
        position: round(stop.position, 3),
        color: serializeColor(stop.color),
      }));
    } else if (paint.type === 'IMAGE') {
      base.scaleMode = paint.scaleMode;
      if (paint.imageHash) {
        base.imageHash = paint.imageHash;
      }
    }

    return base;
  });
}

export function serializeEffects(effects: readonly Effect[]): SerializedEffect[] {
  return effects.map((effect): SerializedEffect => {
    const item: SerializedEffect = {
      type: effect.type,
    };
    if (effect.visible === false) {
      item.visible = false;
    }
    if ('radius' in effect && typeof effect.radius === 'number') {
      item.radius = round(effect.radius);
    }
    if ('spread' in effect && typeof effect.spread === 'number' && effect.spread !== 0) {
      item.spread = round(effect.spread);
    }
    if ('offset' in effect && effect.offset) {
      item.offset = {
        x: round(effect.offset.x),
        y: round(effect.offset.y),
      };
    }
    if ('color' in effect && effect.color) {
      item.color = serializeColor(effect.color);
    }
    return item;
  });
}

function serializeLineHeight(lh: LineHeight | typeof figma.mixed): string | 'MIXED' {
  if (lh === figma.mixed) {
    return 'MIXED';
  }
  if (lh.unit === 'AUTO') {
    return 'AUTO';
  }
  return lh.unit === 'PIXELS' ? `${round(lh.value)}px` : `${round(lh.value)}%`;
}

function serializeLetterSpacing(ls: LetterSpacing | typeof figma.mixed): string | 'MIXED' {
  if (ls === figma.mixed) {
    return 'MIXED';
  }
  return ls.unit === 'PIXELS' ? `${round(ls.value)}px` : `${round(ls.value)}%`;
}

function serializeCornerRadius(
  node: BaseNode,
): number | SerializedCornerRadius | 'MIXED' | undefined {
  if (!('cornerRadius' in node)) {
    return undefined;
  }

  const radius = node.cornerRadius;
  if (radius === figma.mixed) {
    if (
      'topLeftRadius' in node &&
      'topRightRadius' in node &&
      'bottomRightRadius' in node &&
      'bottomLeftRadius' in node
    ) {
      return {
        topLeft: round(node.topLeftRadius),
        topRight: round(node.topRightRadius),
        bottomRight: round(node.bottomRightRadius),
        bottomLeft: round(node.bottomLeftRadius),
      };
    }
    return 'MIXED';
  }

  return typeof radius === 'number' && radius > 0 ? round(radius) : undefined;
}

function serializeBounds(node: BaseNode): SerializedRect | undefined {
  if (!('absoluteBoundingBox' in node) || !node.absoluteBoundingBox) {
    return undefined;
  }
  const { x, y, width, height } = node.absoluteBoundingBox;
  return {
    x: round(x),
    y: round(y),
    width: round(width),
    height: round(height),
  };
}

function serializeLayout(node: BaseNode): SerializedLayout | undefined {
  const hasLayoutMode = 'layoutMode' in node;
  const hasSizing = 'layoutSizingHorizontal' in node || 'layoutSizingVertical' in node;
  if (!hasLayoutMode && !hasSizing) {
    return undefined;
  }

  const layout: SerializedLayout = {};
  if (hasLayoutMode) {
    if (node.layoutMode !== 'NONE') {
      layout.layoutMode = node.layoutMode;
      layout.primaryAxisAlignItems = node.primaryAxisAlignItems;
      layout.counterAxisAlignItems = node.counterAxisAlignItems;
      if ('layoutWrap' in node && node.layoutWrap !== 'NO_WRAP') {
        layout.layoutWrap = node.layoutWrap;
      }
      if (node.itemSpacing !== 0) {
        layout.itemSpacing = round(node.itemSpacing);
      }
      if (
        'counterAxisSpacing' in node &&
        typeof node.counterAxisSpacing === 'number' &&
        node.counterAxisSpacing !== 0
      ) {
        layout.counterAxisSpacing = round(node.counterAxisSpacing);
      }
      const { paddingTop, paddingRight, paddingBottom, paddingLeft } = node;
      if (paddingTop !== 0 || paddingRight !== 0 || paddingBottom !== 0 || paddingLeft !== 0) {
        layout.padding = {
          top: round(paddingTop),
          right: round(paddingRight),
          bottom: round(paddingBottom),
          left: round(paddingLeft),
        };
      }
    }
  }

  if ('layoutSizingHorizontal' in node) {
    layout.sizingHorizontal = node.layoutSizingHorizontal;
  }
  if ('layoutSizingVertical' in node) {
    layout.sizingVertical = node.layoutSizingVertical;
  }

  return Object.keys(layout).length > 0 ? layout : undefined;
}

function serializeText(node: TextNode): SerializedTextStyle {
  const text: SerializedTextStyle = {
    characters: node.characters,
    textAlignHorizontal: node.textAlignHorizontal,
    textAlignVertical: node.textAlignVertical,
  };

  if (node.fontName === figma.mixed) {
    text.fontFamily = 'MIXED';
    text.fontStyle = 'MIXED';
  } else {
    text.fontFamily = node.fontName.family;
    text.fontStyle = node.fontName.style;
  }

  text.fontSize = node.fontSize === figma.mixed ? 'MIXED' : round(node.fontSize);
  text.lineHeight = serializeLineHeight(node.lineHeight);
  text.letterSpacing = serializeLetterSpacing(node.letterSpacing);

  if (node.textDecoration === figma.mixed) {
    text.textDecoration = 'MIXED';
  } else if (node.textDecoration !== 'NONE') {
    text.textDecoration = node.textDecoration;
  }

  if (node.textCase === figma.mixed) {
    text.textCase = 'MIXED';
  } else if (node.textCase !== 'ORIGINAL') {
    text.textCase = node.textCase;
  }

  return text;
}

export async function serializeNode(
  node: BaseNode,
  depth: number,
  includeHidden: boolean,
): Promise<SerializedNode> {
  const visible = 'visible' in node ? node.visible : true;
  const serialized: SerializedNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible,
  };

  if ('opacity' in node && typeof node.opacity === 'number' && node.opacity < 0.999) {
    serialized.opacity = round(node.opacity, 3);
  }

  const bounds = serializeBounds(node);
  if (bounds) {
    serialized.bounds = bounds;
  }

  const cornerRadius = serializeCornerRadius(node);
  if (cornerRadius !== undefined) {
    serialized.cornerRadius = cornerRadius;
  }

  if ('fills' in node) {
    const fills = serializePaints(node.fills);
    if (fills === 'MIXED' || fills.length > 0) {
      serialized.fills = fills;
    }
  }

  if ('strokes' in node) {
    const strokes = serializePaints(node.strokes);
    if (strokes === 'MIXED' || strokes.length > 0) {
      serialized.strokes = strokes;
      if ('strokeWeight' in node) {
        serialized.strokeWeight =
          node.strokeWeight === figma.mixed ? 'MIXED' : round(node.strokeWeight);
      }
    }
  }

  if ('effects' in node && node.effects.length > 0) {
    serialized.effects = serializeEffects(node.effects);
  }

  const layout = serializeLayout(node);
  if (layout) {
    serialized.layout = layout;
  }

  if (node.type === 'TEXT') {
    serialized.text = serializeText(node);
  }

  if (node.type === 'INSTANCE') {
    try {
      const mainComponent = await node.getMainComponentAsync();
      if (mainComponent) {
        serialized.componentId = mainComponent.id;
      }
    } catch {
      // Ignore inaccessible remote main components
    }
  }

  if ('children' in node) {
    const visibleChildren = node.children.filter((child) =>
      includeHidden ? true : 'visible' in child ? child.visible : true,
    );

    if (depth > 0) {
      serialized.children = await Promise.all(
        visibleChildren.map((child) => serializeNode(child, depth - 1, includeHidden)),
      );
    } else if (visibleChildren.length > 0) {
      serialized.truncatedChildrenCount = visibleChildren.length;
    }
  }

  return serialized;
}

function serializeVariableValue(value: VariableValue): unknown {
  if (typeof value === 'object' && value !== null) {
    if ('type' in value && value.type === 'VARIABLE_ALIAS') {
      return { type: 'VARIABLE_ALIAS', id: value.id };
    }
    if ('r' in value && 'g' in value && 'b' in value) {
      return serializeColor(value as RGBA);
    }
  }
  return value;
}

export async function serializeLocalTokens(): Promise<SerializedTokens> {
  const [rawPaintStyles, rawTextStyles, rawEffectStyles, rawCollections, rawVariables] =
    await Promise.all([
      figma.getLocalPaintStylesAsync(),
      figma.getLocalTextStylesAsync(),
      figma.getLocalEffectStylesAsync(),
      figma.variables.getLocalVariableCollectionsAsync(),
      figma.variables.getLocalVariablesAsync(),
    ]);

  const paintStyles: SerializedPaintStyle[] = rawPaintStyles.map((style) => {
    const paints = serializePaints(style.paints);
    return {
      id: style.id,
      name: style.name,
      ...(style.description ? { description: style.description } : {}),
      paints: paints === 'MIXED' ? [] : paints,
    };
  });

  const textStyles: SerializedTextStyleToken[] = rawTextStyles.map((style) => ({
    id: style.id,
    name: style.name,
    ...(style.description ? { description: style.description } : {}),
    fontFamily: style.fontName.family,
    fontStyle: style.fontName.style,
    fontSize: round(style.fontSize),
    lineHeight: serializeLineHeight(style.lineHeight) as string,
    letterSpacing: serializeLetterSpacing(style.letterSpacing) as string,
  }));

  const effectStyles: SerializedEffectStyle[] = rawEffectStyles.map((style) => ({
    id: style.id,
    name: style.name,
    ...(style.description ? { description: style.description } : {}),
    effects: serializeEffects(style.effects),
  }));

  const variableCollections: SerializedVariableCollection[] = rawCollections.map((collection) => ({
    id: collection.id,
    name: collection.name,
    defaultModeId: collection.defaultModeId,
    modes: collection.modes.map((mode) => ({
      modeId: mode.modeId,
      name: mode.name,
    })),
  }));

  const variables: SerializedVariable[] = rawVariables.map((variable) => {
    const valuesByMode: Record<string, unknown> = {};
    for (const [modeId, value] of Object.entries(variable.valuesByMode)) {
      valuesByMode[modeId] = serializeVariableValue(value);
    }
    return {
      id: variable.id,
      name: variable.name,
      ...(variable.description ? { description: variable.description } : {}),
      collectionId: variable.variableCollectionId,
      resolvedType: variable.resolvedType,
      valuesByMode,
    };
  });

  return {
    paintStyles,
    textStyles,
    effectStyles,
    variableCollections,
    variables,
  };
}
