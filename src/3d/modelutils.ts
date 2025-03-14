import { BufferAttribute } from "three";
import { ModelData, ModelMeshData } from "./rt7model";

type rgb = [r: number, g: number, b: number];
type xyz = [x: number, y: number, z: number];

const white: rgb = [255, 255, 255];
const red: rgb = [255, 0, 0];
const tile = 512;
const halftile = 256;
const wall = tile * 192 / 128;//based on wall height
const rooftop = wall + tile / 2;
const roofoverhang = halftile + tile / 5;
const roofhang = wall;// wall - (rooftop - wall) / tile * (roofoverhang - halftile);
const roofcorner = rooftop - (rooftop - roofhang) / (halftile + roofoverhang) * tile;

function getnormal(v0: xyz, v1: xyz, v2: xyz): xyz {
    let normx = (v2[1] - v0[1]) * (v1[2] - v0[2]) - (v1[1] - v0[1]) * (v2[2] - v0[2]);
    let normy = (v2[2] - v0[2]) * (v1[0] - v0[0]) - (v1[2] - v0[2]) * (v2[0] - v0[0]);
    let normz = (v2[0] - v0[0]) * (v1[1] - v0[1]) - (v1[0] - v0[0]) * (v2[1] - v0[1]);
    let invlen = 1 / Math.hypot(normx, normy, normz);
    return [normx * invlen, normy * invlen, normz * invlen];
}

export class MeshBuilder {
    pos: number[] = [];
    color: number[] = [];
    uvs: number[] = [];
    index: number[] = [];
    normals: number[] = [];
    vertindex = 0;
    parent: ModelBuilder | null;
    constructor(parent: ModelBuilder | null) {
        this.parent = parent;
    }
    addParallelogram(col: rgb, v0: xyz, v1: xyz, v2: xyz) {
        let v3 = [
            v0[0] + v2[0] - v1[0],
            v0[1] + v2[1] - v1[1],
            v0[2] + v2[2] - v1[2]
        ];
        let norm = getnormal(v0, v1, v2);
        this.pos.push(...v0, ...v1, ...v2, ...v3);
        this.color.push(...col, ...col, ...col, ...col);
        this.normals.push(...norm, ...norm, ...norm, ...norm)
        this.uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
        this.index.push(
            this.vertindex + 0, this.vertindex + 2, this.vertindex + 1,
            this.vertindex + 0, this.vertindex + 3, this.vertindex + 2,
        );
        this.vertindex += 4;
        return this;
    }
    addTriangle(col: rgb, v0: xyz, v1: xyz, v2: xyz) {
        let norm = getnormal(v0, v2, v1);
        this.color.push(...col, ...col, ...col);
        this.pos.push(...v0, ...v1, ...v2);
        this.uvs.push(0, 0, 0, 1, 1, 1);
        this.normals.push(...norm, ...norm, ...norm);
        this.index.push(this.vertindex + 0, this.vertindex + 1, this.vertindex + 2);
        this.vertindex += 3;
        return this;
    }
    addCube(col: rgb, [centerx, centery, centerz]: xyz, [sizex, sizey, sizez]: xyz) {
        let x0 = centerx - sizex / 2;
        let y0 = centery - sizey / 2;
        let z0 = centerz - sizez / 2;
        let x1 = x0 + sizex;
        let y1 = y0 + sizey;
        let z1 = z0 + sizez;
        this.addParallelogram(col, [x0, y0, z0], [x1, y0, z0], [x1, y1, z0]);
        this.addParallelogram(col, [x1, y0, z0], [x1, y0, z1], [x1, y1, z1]);
        this.addParallelogram(col, [x1, y0, z1], [x0, y0, z1], [x0, y1, z1]);
        this.addParallelogram(col, [x0, y0, z1], [x0, y0, z0], [x0, y1, z0]);
        this.addParallelogram(col, [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]);
        this.addParallelogram(col, [x0, y1, z0], [x1, y1, z0], [x1, y1, z1]);
        return this;
    }
    addExtrusion(color: rgb, vector: xyz, points: xyz[]) {
        //side faces
        let prevpoint = points[points.length - 1];
        if (Math.hypot(...vector) != 0) {
            for (let a = 0; a < points.length; a++) {
                let point = points[a];
                this.addParallelogram(color, prevpoint, point, [point[0] + vector[0], point[1] + vector[1], point[2] + vector[2]]);
                prevpoint = point;
            }
        }

        if (points.length > 2) {
            let dx1 = points[2][0] - points[1][0], dy1 = points[2][0] - points[1][0], dz1 = points[2][0] - points[1][0];
            let dx2 = points[0][0] - points[1][0], dy2 = points[0][0] - points[1][0], dz2 = points[0][0] - points[1][0];
            let normx = dy2 * dz1 - dy1 * dz2;
            let normy = dz2 * dx1 - dz1 * dx2;
            let normz = dx2 * dy1 - dx1 * dy2;
            let len = Math.hypot(normx, normy, normz);
            normx /= len;
            normy /= len;
            normz /= len;

            //top polygon
            let zeroindex = -1;
            let previndex = -1;
            for (let a = 0; a < points.length; a++) {
                let point = points[a];
                this.pos.push(...point);
                this.color.push(...color);
                this.uvs.push(0, 0);
                this.normals.push(normx, normy, normz);
                let index = this.vertindex++;
                if (zeroindex == -1) {
                    zeroindex = index;
                } else if (previndex == -1) {
                    previndex = index
                } else {
                    this.index.push(zeroindex, previndex, index);
                    previndex = index;
                }
            }
            //bottom polygon
            zeroindex = -1;
            previndex = -1;
            for (let a = points.length - 1; a >= 0; a--) {
                let point = points[a];
                this.pos.push(...point);
                this.color.push(...color);
                this.uvs.push(0, 0);
                this.normals.push(-normx, -normy, -normz);
                let index = this.vertindex++;
                if (zeroindex == -1) {
                    zeroindex = index;
                } else if (previndex == -1) {
                    previndex = index
                } else {
                    this.index.push(zeroindex, previndex, index);
                    previndex = index;
                }
            }
        }
        return this;
    }
    convertSubmesh(matid: number): ModelData["meshes"][number] {
        let indices = new BufferAttribute(new Uint16Array(this.index), 1);
        return {
            attributes: {
                pos: new BufferAttribute(new Float32Array(this.pos), 3),
                color: new BufferAttribute(new Uint8Array(this.color), 3, true),
                texuvs: new BufferAttribute(new Float32Array(this.uvs), 2),
                normals: new BufferAttribute(new Float32Array(this.normals), 3)
            },
            indices,
            indexLODs: [indices],
            hasVertexAlpha: false,
            materialId: matid,
            needsNormalBlending: false,
        }
    }
    mat(mat: number) {
        return this.parent!.mat(mat);
    }
    convert() {
        return this.parent!.convert();
    }
}

function meshBuildersToModel(builders: Map<number, MeshBuilder>): ModelData {
    let miny = 0;
    let maxy = 0;

    let meshes: ModelMeshData[] = []
    builders.forEach((builder, mat) => {
        let mesh = builder.convertSubmesh(mat);
        meshes.push(mesh);
        let posattr = mesh.attributes.pos;
        for (let i = 0; i < posattr.count; i++) {
            let y = posattr.getY(i);
            miny = Math.min(miny, y);
            maxy = Math.max(maxy, y);
        }
    });

    return {
        miny, maxy,
        bonecount: 0,
        skincount: 0,
        meshes
    }
}

export class ModelBuilder {
    meshes = new Map<number, MeshBuilder>();

    mat(mat: number) {
        let mesh = this.meshes.get(mat);
        if (!mesh) {
            mesh = new MeshBuilder(this);
            this.meshes.set(mat, mesh);
        }
        return mesh;
    }
    convert() {
        return meshBuildersToModel(this.meshes);
    }
}

export const materialPreviewCube = new ModelBuilder()
    .mat(0).addCube(white, [0, 300, 0], [600, 600, 600])
    .convert();

export const classicWall = new ModelBuilder()
    .mat(0).addParallelogram(white, [-halftile, 0, halftile], [-halftile, tile, halftile], [-halftile, tile, -halftile])
    .mat(1).addParallelogram(red, [-halftile, 0, -halftile], [-halftile, tile, -halftile], [-halftile, tile, halftile])
    .convert();

export const classicWallDiag = new ModelBuilder()
    .mat(0).addParallelogram(white, [halftile, 0, halftile], [halftile, tile, halftile], [-halftile, tile, -halftile])
    .mat(1).addParallelogram(white, [-halftile, 0, -halftile], [-halftile, tile, -halftile], [halftile, tile, halftile])
    .convert();

//low flat
export const classicRoof10 = new ModelBuilder()
    .mat(0).addParallelogram(white, [-roofoverhang, roofcorner, -roofoverhang], [roofoverhang, roofcorner, -roofoverhang], [roofoverhang, roofcorner, roofoverhang])
    .convert();

//edge
export const classicRoof12 = new ModelBuilder()
    .mat(0).addParallelogram(white, [-halftile, rooftop, halftile], [-halftile, rooftop, -halftile], [roofoverhang, roofhang, -halftile])
    .convert();

//diagcorner
export const classicRoof13 = new ModelBuilder()
    .mat(0).addTriangle(white, [roofoverhang, roofhang, halftile], [-halftile, roofhang, -roofoverhang], [-halftile, rooftop, halftile])
    .convert();

//upper convex part
export const classicRoof14 = new ModelBuilder()
    .mat(0).addTriangle(white, [-halftile, rooftop, -halftile], [-halftile, rooftop, halftile], [halftile, rooftop, halftile])
    .mat(0).addTriangle(white, [-halftile, rooftop, -halftile], [halftile, rooftop, halftile], [halftile, roofcorner, -halftile])
    .convert();

//diagonal center roof
export const classicRoof15 = new ModelBuilder()
    .mat(0).addTriangle(white, [halftile, rooftop, halftile], [-halftile, rooftop, -halftile], [-halftile, roofcorner, halftile])
    .mat(0).addTriangle(white, [-halftile, rooftop, -halftile], [halftile, rooftop, halftile], [halftile, roofcorner, -halftile])
    .convert();

//corner
export const classicRoof16 = new ModelBuilder()
    .mat(0).addTriangle(white, [roofoverhang, roofhang, -roofoverhang], [-halftile, roofhang, -roofoverhang], [-halftile, rooftop, halftile])
    .mat(0).addTriangle(white, [roofoverhang, roofhang, halftile], [roofoverhang, roofhang, -roofoverhang], [-halftile, rooftop, halftile])
    .convert();

//flat rooftop
export const classicRoof17 = new ModelBuilder()
    .mat(0).addParallelogram(white, [-halftile, rooftop, -halftile], [halftile, rooftop, -halftile], [halftile, rooftop, halftile])
    .convert();


export const topdown2dWallModels = generateTopdown2dWallModels();


function generateTopdown2dWallModels() {
    const thick = tile / 8;
    const height = 0;
    const wallvec: xyz = [0, height, 0];
    return {
        wall: new ModelBuilder().mat(0).addExtrusion(white, wallvec, [
            [-halftile, 0, -halftile],
            [-halftile, 0, halftile],
            [-halftile + thick, 0, halftile],
            [-halftile + thick, 0, -halftile]
        ]).convert(),
        shortcorner: new ModelBuilder().mat(0).addExtrusion(white, wallvec, [
            [-halftile, 0, halftile],
            [-halftile + thick, 0, halftile],
            [-halftile + thick, 0, halftile - thick],
            [-halftile, 0, halftile - thick]
        ]).convert(),
        longcorner: new ModelBuilder().mat(0).addExtrusion(white, wallvec, [
            [-halftile + thick, 0, halftile - thick],
            [-halftile + thick, 0, -halftile],
            [-halftile, 0, -halftile],
            [-halftile, 0, halftile],
            [halftile, 0, halftile],
            [halftile, 0, halftile - thick],
        ]).convert(),
        pillar: new ModelBuilder().mat(0).addExtrusion(white, wallvec, [
            [-halftile + thick, 0, halftile - thick],
            [-halftile + thick, 0, -halftile],
            [-halftile, 0, -halftile],
            [-halftile, 0, halftile],
            [halftile, 0, halftile],
            [halftile, 0, halftile - thick],
        ]).convert(),
        diagonal: new ModelBuilder().mat(0).addExtrusion(white, wallvec, [
            [-halftile, 0, halftile],
            [-halftile + thick, 0, halftile],
            [-halftile + thick, 0, halftile - thick],
            [-halftile, 0, halftile - thick]
        ]).convert(),
    }
}