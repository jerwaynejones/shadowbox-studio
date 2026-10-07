/*******************************************************************************
* Author    :  Angus Johnson                                                   *
* Date      :  16 July 2023                                                    *
* Website   :  http://www.angusj.com                                           *
* Copyright :  Angus Johnson 2010-2023                                         *
* Purpose   :  This module contains simple functions that will likely cover    *
*              most polygon boolean and offsetting needs, while also avoiding  *
*              the inherent complexities of the other modules.                 *
* Thanks    :  Special thanks to Thong Nguyen, Guus Kuiper, Phil Stopford,     *
*           :  and Daniel Gosnell for their invaluable assistance with C#.     *
* License   :  http://www.boost.org/LICENSE_1_0.txt                            *
*******************************************************************************/
import { ClipType, FillRule, IPoint64, Path64, Paths64, Point64, Rect64 } from "./core";
import { PointInPolygonResult, PolyTree64 } from "./engine";
import { EndType, JoinType } from "./offset";
export declare class Clipper {
    private static invalidRect64;
    static get InvalidRect64(): Rect64;
    static Intersect(subject: Paths64, clip: Paths64, fillRule: FillRule): Paths64;
    static Union(subject: Paths64, clip?: Paths64, fillRule?: FillRule): Paths64;
    static Difference(subject: Paths64, clip: Paths64, fillRule: FillRule): Paths64;
    static Xor(subject: Paths64, clip: Paths64, fillRule: FillRule): Paths64;
    static BooleanOp(clipType: ClipType, subject?: Paths64, clip?: Paths64, fillRule?: FillRule): Paths64;
    static InflatePaths(paths: Paths64, delta: number, joinType: JoinType, endType: EndType, miterLimit?: number): Paths64;
    static RectClipPaths(rect: Rect64, paths: Paths64): Paths64;
    static RectClip(rect: Rect64, path: Path64): Paths64;
    static RectClipLinesPaths(rect: Rect64, paths: Paths64): Paths64;
    static RectClipLines(rect: Rect64, path: Path64): Paths64;
    static MinkowskiSum(pattern: Path64, path: Path64, isClosed: boolean): Paths64;
    static MinkowskiDiff(pattern: Path64, path: Path64, isClosed: boolean): Paths64;
    static area(path: Path64): number;
    static areaPaths(paths: Paths64): number;
    static isPositive(poly: Path64): boolean;
    static path64ToString(path: Path64): string;
    static paths64ToString(paths: Paths64): string;
    static offsetPath(path: Path64, dx: number, dy: number): Path64;
    static scalePoint64(pt: Point64, scale: number): Point64;
    static scalePath(path: Path64, scale: number): Path64;
    static scalePaths(paths: Paths64, scale: number): Paths64;
    static translatePath(path: Path64, dx: number, dy: number): Path64;
    static translatePaths(paths: Paths64, dx: number, dy: number): Paths64;
    static reversePath(path: Path64): Path64;
    static reversePaths(paths: Paths64): Paths64;
    static getBounds(path: Path64): Rect64;
    static getBoundsPaths(paths: Paths64): Rect64;
    static makePath(arr: number[]): Path64;
    static stripDuplicates(path: Path64, isClosedPath: boolean): Path64;
    private static addPolyNodeToPaths;
    static polyTreeToPaths64(polyTree: PolyTree64): Paths64;
    static perpendicDistFromLineSqrd(pt: IPoint64, line1: IPoint64, line2: IPoint64): number;
    static rdp(path: Path64, begin: number, end: number, epsSqrd: number, flags: boolean[]): void;
    static ramerDouglasPeucker(path: Path64, epsilon: number): Path64;
    static ramerDouglasPeuckerPaths(paths: Paths64, epsilon: number): Paths64;
    private static getNext;
    private static getPrior;
    private static sqr;
    static simplifyPath(path: Path64, epsilon: number, isClosedPath?: boolean): Path64;
    static simplifyPaths(paths: Paths64, epsilon: number, isClosedPaths?: boolean): Paths64;
    static trimCollinear(path: Path64, isOpen?: boolean): Path64;
    static pointInPolygon(pt: Point64, polygon: Path64): PointInPolygonResult;
    static ellipse(center: IPoint64, radiusX: number, radiusY?: number, steps?: number): Path64;
    private static showPolyPathStructure;
    static showPolyTreeStructure(polytree: PolyTree64): void;
}
