/*******************************************************************************
* Author    :  Angus Johnson                                                   *
* Date      :  8 September 2023                                                  *
* Website   :  http://www.angusj.com                                           *
* Copyright :  Angus Johnson 2010-2023                                         *
* Purpose   :  FAST rectangular clipping                                       *
* License   :  http://www.boost.org/LICENSE_1_0.txt                            *
*******************************************************************************/
import { IPoint64, Path64, Paths64, Point64, Rect64 } from "./core";
export declare class OutPt2 {
    next?: OutPt2;
    prev?: OutPt2;
    pt: IPoint64;
    ownerIdx: number;
    edge?: Array<OutPt2 | undefined>;
    constructor(pt: IPoint64);
}
declare enum Location {
    left = 0,
    top = 1,
    right = 2,
    bottom = 3,
    inside = 4
}
export declare class RectClip64 {
    protected rect: Rect64;
    protected mp: Point64;
    protected rectPath: Path64;
    protected pathBounds: Rect64;
    protected results: Array<OutPt2 | undefined>;
    protected edges: Array<OutPt2 | undefined>[];
    protected currIdx: number;
    constructor(rect: Rect64);
    protected add(pt: IPoint64, startingNewPath?: boolean): OutPt2;
    private static path1ContainsPath2;
    private static isClockwise;
    private static areOpposites;
    private static headingClockwise;
    private static getAdjacentLocation;
    private static unlinkOp;
    private static unlinkOpBack;
    private static getEdgesForPt;
    private static isHeadingClockwise;
    private static hasHorzOverlap;
    private static hasVertOverlap;
    private static addToEdge;
    private static uncoupleEdge;
    private static setNewOwner;
    private addCorner;
    private addCornerByRef;
    protected static getLocation(rec: Rect64, pt: IPoint64): {
        success: boolean;
        loc: Location;
    };
    private static isHorizontal;
    private static getSegmentIntersection;
    protected static getIntersection(rectPath: Path64, p: IPoint64, p2: IPoint64, loc: Location): {
        success: boolean;
        loc: Location;
        ip: IPoint64;
    };
    protected getNextLocation(path: Path64, context: {
        loc: Location;
        i: number;
        highI: number;
    }): void;
    protected executeInternal(path: Path64): void;
    execute(paths: Paths64): Paths64;
    private checkEdges;
    private tidyEdgePair;
    protected getPath(op: OutPt2 | undefined): Path64;
}
export declare class RectClipLines64 extends RectClip64 {
    constructor(rect: Rect64);
    execute(paths: Paths64): Paths64;
    protected getPath(op: OutPt2 | undefined): Path64;
    protected executeInternal(path: Path64): void;
}
export {};
