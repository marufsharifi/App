import {Group, Text as SkiaText, vec} from '@shopify/react-native-skia';
import type {SkFont} from '@shopify/react-native-skia';
import React, {useMemo} from 'react';
import type {AxisLabelRenderer} from 'victory-native';
import {AXIS_LABEL_GAP} from '@components/Charts/constants';
import type {LabelRotation} from '@components/Charts/types';
import {measureTextWidth, rotatedLabelCenterCorrection, rotatedLabelYOffset} from '@components/Charts/utils';

type ChartXAxisLabelsProps = {
    /** Processed label strings (already truncated by the layout hook). */
    labels: string[];

    /** Label rotation in degrees (e.g. 0, 45, 90). */
    labelRotation: LabelRotation;

    /** Show every Nth label (1 = all, 2 = every other, etc.). */
    labelSkipInterval: number;

    /** Skia font used for measuring and rendering labels. */
    font: SkFont;

    /** Fill color for the label text. */
    labelColor: string;

    /** Optional Paragraph renderer for CJK-capable labels. */
    labelRenderer?: AxisLabelRenderer;

    /** Maps a data-point index to its x-pixel position on the chart. */
    xScale: (value: number) => number;

    /** Y-pixel coordinate of the bottom edge of the chart plot area. */
    chartBoundsBottom: number;

    /** When true, rotated labels are centered on the tick. When false, they are right-aligned (end of text at tick). */
    centerRotatedLabels?: boolean;
};

function ChartXAxisLabels({labels, labelRotation, labelSkipInterval, font, labelColor, labelRenderer, xScale, chartBoundsBottom, centerRotatedLabels = false}: ChartXAxisLabelsProps) {
    const angleRad = (Math.abs(labelRotation) * Math.PI) / 180;

    const fontMetrics = font.getMetrics();
    const ascent = Math.abs(fontMetrics.ascent);
    const descent = Math.abs(fontMetrics.descent);
    const correction = rotatedLabelCenterCorrection(ascent, descent, angleRad);

    const labelMeasurements = useMemo(
        () =>
            labels.map((label) => ({
                width: measureTextWidth(label, font, labelRenderer),
                height: labelRenderer?.measureText(label).height ?? font.getSize(),
            })),
        [font, labelRenderer, labels],
    );
    const labelWidths = labelMeasurements.map((measurement) => measurement.width);

    // Centered labels extend upward by (maxWidth/2)*sin(angle) from the anchor;
    // push the anchor down so the top of the bounding box clears chartBoundsBottom.
    const centeredUpwardOffset = centerRotatedLabels && angleRad > 0 ? (Math.max(...labelWidths) / 2) * Math.sin(angleRad) : 0;
    const labelY = chartBoundsBottom + AXIS_LABEL_GAP + rotatedLabelYOffset(ascent, descent, angleRad) + centeredUpwardOffset;

    return labels.map((label, i) => {
        if (i % labelSkipInterval !== 0 || label.length === 0) {
            return null;
        }

        const tickX = xScale(i);
        const labelWidth = labelMeasurements.at(i)?.width ?? 0;
        const labelHeight = labelMeasurements.at(i)?.height ?? font.getSize();

        if (angleRad === 0) {
            if (labelRenderer) {
                return (
                    <React.Fragment key={`x-label-${label}-${i}`}>
                        {labelRenderer.render({
                            text: label,
                            color: labelColor,
                            x: tickX - labelWidth / 2,
                            y: chartBoundsBottom + AXIS_LABEL_GAP,
                            width: labelWidth,
                            height: labelHeight,
                        })}
                    </React.Fragment>
                );
            }
            return (
                <SkiaText
                    key={`x-label-${label}`}
                    x={tickX - labelWidth / 2}
                    y={labelY}
                    text={label}
                    font={font}
                    color={labelColor}
                />
            );
        }

        const textX = centerRotatedLabels ? tickX - labelWidth / 2 : tickX - labelWidth;
        const origin = labelRenderer ? vec(textX + labelWidth / 2, chartBoundsBottom + AXIS_LABEL_GAP + labelHeight / 2) : vec(tickX, labelY);

        return (
            <Group
                key={`x-label-${label}`}
                origin={origin}
                transform={labelRenderer ? [{rotate: -angleRad}] : [{translateX: correction}, {rotate: -angleRad}]}
            >
                {labelRenderer ? (
                    labelRenderer.render({
                        text: label,
                        color: labelColor,
                        x: textX,
                        y: chartBoundsBottom + AXIS_LABEL_GAP,
                        width: labelWidth,
                        height: labelHeight,
                    })
                ) : (
                    <SkiaText
                        x={textX}
                        y={labelY}
                        text={label}
                        font={font}
                        color={labelColor}
                    />
                )}
            </Group>
        );
    });
}

export default ChartXAxisLabels;
export type {ChartXAxisLabelsProps};
