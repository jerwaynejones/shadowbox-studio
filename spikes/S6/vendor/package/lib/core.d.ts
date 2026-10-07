/*******************************************************************************
* Author    :  Angus Johnson                                                   *
* Date      :  19 September 2023                                               *
* Website   :  http://www.angusj.com                                           *
* Copyright :  Angus Johnson 2010-2023                                         *
* Purpose   :  Core structures and functions for the Clipper Library           *
* License   :  http://www.boost.org/LICENSE_1_0.txt                            *
*******************************************************************************/
import { PointInPolygonResult } from "./engine";
export declare enum ClipType {
    None = 0,
    Intersection = 1,
    Union = 2,
    Difference = 3,
    Xor = 4
}
export declare enum PathType {
    Subject = 0,
    Clip = 1
}
export declare enum FillRule {
    EvenOdd = 0,
    NonZero = 1,
    Positive = 2,
    Negative = 3
}
export declare enum PipResult {
    Inside = 0,
    Outside = 1,
    OnEdge = 2
}
export interface IPoint64 {
    x: number;
    y: number;
}
export declare class Path64 extends Array<IPoint64> {
}
export declare class Paths64 extends Array<Path64> {
}
export declare class Rect64 {
    left: number;
    top: number;
    right: number;
    bottom: number;
    constructor(lOrIsValidOrRec?: number | boolean | Rect64, t?: number, r?: number, b?: number);
    get width(): number;
    set width(value: number);
    get height(): number;
    set height(value: number);
    isEmpty(): boolean;
    midPoint(): Point64;
    contains(pt: IPoint64): boolean;
    containsRect(rec: Rect64): boolean;
    intersects(rec: Rect64): boolean;
    asPath(): Path64;
}
export declare enum MidpointRounding {
    ToEven = 0,
    AwayFromZero = 1
}
export declare function midPointRound(value: number, mode?: MidpointRounding): number;
export declare class Point64 implements IPoint64 {
    x: number;
    y: number;
    constructor(xOrPt?: number | Point64, yOrScale?: number);
    static equals(lhs: Point64, rhs: Point64): boolean;
    static notEquals(lhs: Point64, rhs: Point64): boolean;
    static add(lhs: Point64, rhs: Point64): Point64;
    static subtract(lhs: Point64, rhs: Point64): Point64;
    toString(): string;
    equals(obj: Point64): boolean;
}
export declare class InternalClipper {
    static readonly MaxInt64: number;
    static readonly MaxCoord: number;
    static readonly max_coord: number;
    static readonly min_coord: number;
    static readonly Invalid64: number;
    static readonly defaultArcTolerance: number;
    static readonly floatingPointTolerance: number;
    static readonly defaultMinimumEdgeLength: number;
    private static readonly precision_range_error;
    static checkPrecision(precision: number): void;
    static isAlmostZero(value: number): boolean;
    static crossProduct(pt1: IPoint64, pt2: IPoint64, pt3: IPoint64): number;
    static dotProduct(pt1: IPoint64, pt2: IPoint64, pt3: IPoint64): number;
    static checkCastInt64(val: number): number;
    static getIntersectPoint(ln1a: IPoint64, ln1b: IPoint64, ln2a: IPoint64, ln2b: IPoint64): {
        ip: IPoint64;
        success: boolean;
    };
    static segsIntersect(seg1a: IPoint64, seg1b: IPoint64, seg2a: IPoint64, seg2b: IPoint64, inclusive?: boolean): boolean;
    static getClosestPtOnSegment(offPt: IPoint64, seg1: IPoint64, seg2: IPoint64): IPoint64;
    static pointInPolygon(pt: IPoint64, polygon: Path64): PointInPolygonResult;
}
