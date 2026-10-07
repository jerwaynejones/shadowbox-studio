/*******************************************************************************
* Author    :  Angus Johnson                                                   *
* Date      :  24 September 2023                                               *
* Website   :  http://www.angusj.com                                           *
* Copyright :  Angus Johnson 2010-2023                                         *
* Purpose   :  Path Offset (Inflate/Shrink)                                    *
* License   :  http://www.boost.org/LICENSE_1_0.txt                            *
*******************************************************************************/
import { IPoint64, Paths64, Point64 } from "./core";
import { PolyTree64 } from "./engine";
export declare enum JoinType {
    Miter = 0,
    Square = 1,
    Bevel = 2,
    Round = 3
}
export declare enum EndType {
    Polygon = 0,
    Joined = 1,
    Butt = 2,
    Square = 3,
    Round = 4
}
export declare class PointD implements IPoint64 {
    x: number;
    y: number;
    constructor(xOrPt: number | PointD | Point64, yOrScale?: number);
    toString(precision?: number): string;
    static equals(lhs: PointD, rhs: PointD): boolean;
    static notEquals(lhs: PointD, rhs: PointD): boolean;
    equals(obj: PointD): boolean;
    negate(): void;
}
export declare class ClipperOffset {
    private static Tolerance;
    private _groupList;
    private _normals;
    private _solution;
    private _groupDelta;
    private _delta;
    private _mitLimSqr;
    private _stepsPerRad;
    private _stepSin;
    private _stepCos;
    private _joinType;
    private _endType;
    ArcTolerance: number;
    MergeGroups: boolean;
    MiterLimit: number;
    PreserveCollinear: boolean;
    ReverseSolution: boolean;
    DeltaCallback?: (path: IPoint64[], path_norms: PointD[], currPt: number, prevPt: number) => number;
    constructor(miterLimit?: number, arcTolerance?: number, preserveCollinear?: boolean, reverseSolution?: boolean);
    clear(): void;
    addPath(path: Point64[], joinType: JoinType, endType: EndType): void;
    addPaths(paths: Paths64, joinType: JoinType, endType: EndType): void;
    private executeInternal;
    private sqr;
    execute(delta: number, solution: Paths64): void;
    executePolytree(delta: number, polytree: PolyTree64): void;
    protected static getUnitNormal(pt1: IPoint64, pt2: IPoint64): PointD;
    executeCallback(deltaCallback: (path: IPoint64[], path_norms: PointD[], currPt: number, prevPt: number) => number, solution: Point64[][]): void;
    private static getBoundsAndLowestPolyIdx;
    private static translatePoint;
    private static reflectPoint;
    private static almostZero;
    private static hypotenuse;
    private static normalizeVector;
    private static getAvgUnitVector;
    private static intersectPoint;
    private getPerpendic;
    private getPerpendicD;
    private doBevel;
    private doSquare;
    private doMiter;
    private doRound;
    private buildNormals;
    crossProduct(vec1: PointD, vec2: PointD): number;
    dotProduct(vec1: PointD, vec2: PointD): number;
    private offsetPoint;
    private offsetPolygon;
    private offsetOpenJoined;
    private offsetOpenPath;
    private doGroupOffset;
}
