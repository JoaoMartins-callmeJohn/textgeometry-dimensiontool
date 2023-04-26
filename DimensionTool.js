const DimensionsToolName = 'dimensions-tool';
const DimensionsOverlayName = 'dimensions-overlay';

class DimensionsTool extends Autodesk.Viewing.ToolInterface {
  constructor(viewer, options) {
    super();
    this.viewer = viewer;
    this.names = [DimensionsToolName];
    this.active = false;
    this.snapper = null;
    this.points = []; // Points of the currently dimension
    this.linesMeshes = []; // Mesh representing the currently drawn area
    this.text = "";
    this.textMesh = null;
    this.faceNormal = null;
    this.fontName = 'monaco';
    this.material = new THREE.MeshBasicMaterial({ color: 0x000, specular: 0xffffff });
    this.lineMaterial = new THREE.LineBasicMaterial({
      linewidth: 3,
      color: 0x000,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      blending: THREE.NoBlending
    });
    this.fontSize = 4;
    this.lineThickness = 0.5;
    // Hack: delete functions defined on the *instance* of a ToolInterface (we want the tool controller to call our class methods instead)
    delete this.register;
    delete this.deregister;
    delete this.activate;
    delete this.deactivate;
    delete this.getPriority;
    delete this.handleMouseMove;
    delete this.handleSingleClick;
    delete this.handleKeyUp;
  }

  register() {
    this.snapper = new Autodesk.Viewing.Extensions.Snapping.Snapper(this.viewer, { renderSnappedGeometry: false, renderSnappedTopology: false });
    this.viewer.toolController.registerTool(this.snapper);
    this.viewer.toolController.activateTool(this.snapper.getName());
    console.log('DimensionsTool registered.');
  }

  deregister() {
    this.viewer.toolController.deactivateTool(this.snapper.getName());
    this.viewer.toolController.deregisterTool(this.snapper);
    this.snapper = null;
    console.log('DimensionsTool unregistered.');
  }

  activate(name, viewer) {
    if (!this.active) {
      this.viewer.overlays.addScene(DimensionsOverlayName);
      console.log('DimensionsTool activated.');
      this.active = true;
    }
  }

  deactivate(name) {
    if (this.active) {
      this.viewer.overlays.removeScene(DimensionsOverlayName);
      console.log('DimensionsTool deactivated.');
      this.active = false;
      this._reset();
    }
  }

  getPriority() {
    return 13; // Feel free to use any number higher than 0 (which is the priority of all the default viewer tools)
  }

  handleMouseMove(event) {
    if (!this.active) {
      return false;
    }

    this.snapper.indicator.clearOverlays();
    if (this.snapper.isSnapped()) {
      this.viewer.clearSelection();
      const result = this.snapper.getSnapResult();
      const { SnapType } = Autodesk.Viewing.MeasureCommon;
      this.snapper.indicator.render(); // Show indicator when snapped to a vertex
      if (this.points.length == 1) {
        this._update(result.intersectPoint);
      }
    }
    return false;
  }

  handleSingleClick(event, button) {
    if (!this.active) {
      return false;
    }

    if (button === 0 && this.snapper.isSnapped()) {
      const result = this.snapper.getSnapResult();
      const { SnapType } = Autodesk.Viewing.MeasureCommon;
      this.points.push(result.intersectPoint.clone());
      this.faceNormal ? null : this.faceNormal = result.faceNormal.normalize();
      if (this.points.length == 2) {
        this._update();
        this._reset();
        return true; // Stop the event from going to other tools in the stack
      }
    }
    return false;
  }

  handleKeyUp(event, keyCode) {
    if (this.active) {
      if (keyCode === 27) {
        // Finalize the extrude mesh and initialie a new one
        this.points = [];
        this.mesh = null;
        return true;
      }
    }
    return false;
  }

  _update(intermediatePoint = null) {

    //Here we're retrieving Measure Extension to hep obtaing unit and scale...
    let measureExension = this.viewer.getExtension('Autodesk.Measure');

    let firstPoint = this.points[0];
    let lastPoint = intermediatePoint ? intermediatePoint : this.points[this.points.length - 1];
    let distance = lastPoint.distanceTo(firstPoint, lastPoint);
    this.text = measureExension.measureTool.getDistanceAux(distance.toFixed(1));
    let midpoint = new THREE.Vector3((firstPoint.x + lastPoint.x) * 0.5, (firstPoint.y + lastPoint.y) * 0.5, (firstPoint.z + lastPoint.z) * 0.5);
    this._updateText(midpoint);
    this._updateLines(firstPoint, lastPoint);
  }

  _updateLines(firstPoint, lastPoint) {
    this._removeLines();
    this._drawLines(firstPoint, lastPoint);
    this._drawCallouts(firstPoint, lastPoint);
    this._drawArrows(firstPoint, lastPoint);
  }

  _drawArrows(firstPoint, lastPoint) {

    let firstAux = lastPoint.clone().sub(firstPoint).normalize().multiplyScalar(this.fontSize);
    let auxDown = this.faceNormal.clone().cross(firstAux).cross(firstAux).normalize();

    if (lastPoint.clone().sub(firstPoint).length() > 2 * this.fontSize) {
      let firstPoints = [];
      let arrowFirstPoint = firstPoint.clone().add(this.faceNormal.clone().normalize().multiplyScalar(this.fontSize * 0.5));
      firstPoints.push(arrowFirstPoint);
      let arrowSecondPoint = arrowFirstPoint.clone().add(firstAux).add(auxDown.clone().multiplyScalar(this.fontSize * 0.25));
      firstPoints.push(arrowSecondPoint);
      let arrowThirdPoint = arrowSecondPoint.clone().sub(auxDown.clone().multiplyScalar(this.fontSize * 0.5));
      firstPoints.push(arrowThirdPoint);

      let firstBufferPoints = [];
      for (let i = 0; i < firstPoints.length; i++) {
        firstBufferPoints.push(firstPoints[i].x, firstPoints[i].y, firstPoints[i].z);
      }

      let firstGeometry = new THREE.BufferGeometry();
      firstGeometry.addAttribute('position', new THREE.BufferAttribute(new Float32Array(firstBufferPoints), 3));

      firstGeometry.computeBoundingBox();
      firstGeometry.computeBoundingSphere();

      let firstArrowMesh = new THREE.Mesh(firstGeometry, this.lineMaterial);

      this.linesMeshes.push(firstArrowMesh);

      if (!this.viewer.overlays.hasScene(DimensionsOverlayName)) {
        this.viewer.overlays.addScene(DimensionsOverlayName);
      }
      this.viewer.overlays.addMesh(firstArrowMesh, DimensionsOverlayName);

      let secondPoints = [];
      let arrowFirstPoint2 = lastPoint.clone().add(this.faceNormal.clone().normalize().multiplyScalar(this.fontSize * 0.5));
      secondPoints.push(arrowFirstPoint2);
      let firstAux2 = firstPoint.clone().sub(lastPoint).normalize().multiplyScalar(this.fontSize);
      let arrowSecondPoint2 = arrowFirstPoint2.clone().add(firstAux2).add(auxDown.clone().multiplyScalar(this.fontSize * 0.25));
      secondPoints.push(arrowSecondPoint2);
      let arrowThirdPoint2 = arrowSecondPoint2.clone().sub(auxDown.clone().multiplyScalar(this.fontSize * 0.5));
      secondPoints.push(arrowThirdPoint2);

      let secondBufferPoints = [];
      for (let i = 0; i < secondPoints.length; i++) {
        secondBufferPoints.push(secondPoints[i].x, secondPoints[i].y, secondPoints[i].z);
      }

      let secondGeometry = new THREE.BufferGeometry();
      secondGeometry.addAttribute('position', new THREE.BufferAttribute(new Float32Array(secondBufferPoints), 3));

      secondGeometry.computeBoundingBox();
      secondGeometry.computeBoundingSphere();

      let secondArrowMesh = new THREE.Mesh(secondGeometry, this.lineMaterial);

      this.linesMeshes.push(secondArrowMesh);

      this.viewer.overlays.addMesh(secondArrowMesh, DimensionsOverlayName);
    }
  }

  _drawCallouts(firstPoint, lastPoint) {

    let firstPoints = [];
    let firstCallP1 = firstPoint.clone();
    firstPoints.push(firstCallP1);
    let auxDir1 = this.faceNormal.clone().cross(firstPoint.clone().sub(lastPoint)).cross(this.faceNormal).normalize();
    let firstCallP2 = firstCallP1.clone().add(auxDir1.clone().multiplyScalar(this.lineThickness));
    firstPoints.push(firstCallP2);
    let firstCallP3 = firstPoint.clone().add(this.faceNormal.clone().normalize().multiplyScalar(this.fontSize));
    firstPoints.push(firstCallP3);
    firstPoints.push(firstCallP3);
    let firstCallP4 = firstCallP3.clone().add(auxDir1.clone().multiplyScalar(this.lineThickness));
    firstPoints.push(firstCallP4);
    firstPoints.push(firstCallP2);
    let firstGeometry = new THREE.BufferGeometry();

    let firstBufferPoints = [];
    for (let i = 0; i < firstPoints.length; i++) {
      firstBufferPoints.push(firstPoints[i].x, firstPoints[i].y, firstPoints[i].z);
    }

    firstGeometry.addAttribute('position', new THREE.BufferAttribute(new Float32Array(firstBufferPoints), 3));

    let firstCallout = new THREE.Mesh(firstGeometry, this.lineMaterial);

    this.linesMeshes.push(firstCallout);

    if (!this.viewer.overlays.hasScene(DimensionsOverlayName)) {
      this.viewer.overlays.addScene(DimensionsOverlayName);
    }
    this.viewer.overlays.addMesh(firstCallout, DimensionsOverlayName);

    let lastPoints = [];
    let lastCalloutP1 = lastPoint.clone();
    lastPoints.push(lastCalloutP1);
    let lastCalloutP2 = lastCalloutP1.clone().sub(auxDir1.clone().multiplyScalar(this.lineThickness));
    lastPoints.push(lastCalloutP2);
    let lastCalloutP3 = lastPoint.clone().add(this.faceNormal.clone().normalize().multiplyScalar(this.fontSize));
    lastPoints.push(lastCalloutP3);
    lastPoints.push(lastCalloutP3);
    let lastCalloutP4 = lastCalloutP3.clone().sub(auxDir1.clone().multiplyScalar(this.lineThickness));
    lastPoints.push(lastCalloutP4);
    lastPoints.push(lastCalloutP2);

    let lastGeometry = new THREE.BufferGeometry();

    let bufferPoints = [];
    for (let i = 0; i < lastPoints.length; i++) {
      bufferPoints.push(lastPoints[i].x, lastPoints[i].y, lastPoints[i].z);
    }

    lastGeometry.addAttribute('position', new THREE.BufferAttribute(new Float32Array(bufferPoints), 3));

    let lastCallout = new THREE.Mesh(lastGeometry, this.lineMaterial);

    this.linesMeshes.push(lastCallout);

    this.viewer.overlays.addMesh(lastCallout, DimensionsOverlayName);

    this.viewer.impl.sceneUpdated(true);
  }

  _removeLines() {
    for (let i = 0; i < this.linesMeshes.length; i++) {
      this.viewer.overlays.removeMesh(this.linesMeshes[i], DimensionsOverlayName);
      this.viewer.impl.sceneUpdated(true);
    }
  }

  _drawLines(firstPoint, lastPoint) {

    let meshBoxLength = this.textMesh.geometry.boundingBox.max.clone().sub(this.textMesh.geometry.boundingBox.min).length();
    let auxDir1 = lastPoint.clone().sub(firstPoint);
    let auxDown = this.faceNormal.clone().cross(auxDir1).cross(auxDir1).normalize();

    if (meshBoxLength > auxDir1.length() - (2 * this.fontSize)) {
      let firstPoints = [];
      let firstLineP1 = firstPoint.clone().add(this.faceNormal.clone().multiplyScalar((this.fontSize + this.lineThickness) * 0.5));
      firstLineP1.add(auxDir1.clone().normalize().multiplyScalar(this.fontSize * 0.5));
      firstPoints.push(firstLineP1);
      let firstLineP2 = firstLineP1.clone().add(auxDir1.clone().normalize().multiplyScalar(auxDir1.length() - this.fontSize));
      firstPoints.push(firstLineP2);
      let firstLineP3 = firstLineP2.clone().add(auxDown.clone().multiplyScalar(this.lineThickness));
      firstPoints.push(firstLineP3);
      firstPoints.push(firstLineP3);
      firstPoints.push(firstLineP1.clone().add(auxDown.clone().multiplyScalar(this.lineThickness)));
      firstPoints.push(firstLineP1);

      let firstGeometry = new THREE.BufferGeometry();
      let firstBufferPoints = [];

      for (let i = 0; i < firstPoints.length; i++) {
        firstBufferPoints.push(firstPoints[i].x, firstPoints[i].y, firstPoints[i].z);
      }

      firstGeometry.addAttribute('position', new THREE.BufferAttribute(new Float32Array(firstBufferPoints), 3));

      let dimensionLine = new THREE.Mesh(firstGeometry, this.lineMaterial);

      this.linesMeshes.push(dimensionLine);

      if (!this.viewer.overlays.hasScene(DimensionsOverlayName)) {
        this.viewer.overlays.addScene(DimensionsOverlayName);
      }
      this.viewer.overlays.addMesh(dimensionLine, DimensionsOverlayName);
    }
    else {
      let firstPoints = [];
      let firstLineP1 = firstPoint.clone().add(this.faceNormal.clone().normalize().multiplyScalar((this.fontSize + this.lineThickness) * 0.5));
      firstLineP1.add(auxDir1.clone().normalize().multiplyScalar(this.fontSize * 0.5));
      firstPoints.push(firstLineP1);
      let firstLineP2 = firstLineP1.clone().add(auxDir1.clone().normalize().multiplyScalar((auxDir1.length() * 0.5) - (meshBoxLength * 0.7)));
      firstPoints.push(firstLineP2);
      let firstLineP3 = firstLineP2.clone().add(auxDown.clone().multiplyScalar(this.lineThickness));
      firstPoints.push(firstLineP3);
      firstPoints.push(firstLineP3);
      firstPoints.push(firstLineP1.clone().add(auxDown.clone().multiplyScalar(this.lineThickness)));
      firstPoints.push(firstLineP1);

      let firstGeometry = new THREE.BufferGeometry();
      let firstBufferPoints = [];
      for (let i = 0; i < firstPoints.length; i++) {
        firstBufferPoints.push(firstPoints[i].x, firstPoints[i].y, firstPoints[i].z);
      }

      firstGeometry.addAttribute('position', new THREE.BufferAttribute(new Float32Array(firstBufferPoints), 3));

      let dimensionLine1 = new THREE.Mesh(firstGeometry, this.lineMaterial);

      this.linesMeshes.push(dimensionLine1);

      if (!this.viewer.overlays.hasScene(DimensionsOverlayName)) {
        this.viewer.overlays.addScene(DimensionsOverlayName);
      }
      this.viewer.overlays.addMesh(dimensionLine1, DimensionsOverlayName);

      let lastPoints = [];
      let lastLineP1 = lastPoint.clone().add(this.faceNormal.clone().normalize().multiplyScalar((this.fontSize + this.lineThickness) * 0.5));
      let auxDir2 = firstPoint.clone().sub(lastPoint);
      lastLineP1.add(auxDir2.clone().normalize().multiplyScalar(this.fontSize * 0.5));
      lastPoints.push(lastLineP1);
      let lastLineP2 = lastLineP1.clone().add(auxDir2.clone().normalize().multiplyScalar((auxDir2.length() * 0.5) - (meshBoxLength * 0.7)));
      lastPoints.push(lastLineP2);
      let lastLineP3 = lastLineP2.clone().add(auxDown.clone().multiplyScalar(this.lineThickness));
      lastPoints.push(lastLineP3);
      lastPoints.push(lastLineP3);
      lastPoints.push(lastLineP1.clone().add(auxDown.clone().multiplyScalar(this.lineThickness)));
      lastPoints.push(lastLineP1);

      let lastGeometry = new THREE.BufferGeometry();
      let lastBufferPoints = [];
      for (let i = 0; i < lastPoints.length; i++) {
        lastBufferPoints.push(lastPoints[i].x, lastPoints[i].y, lastPoints[i].z);
      }

      lastGeometry.addAttribute('position', new THREE.BufferAttribute(new Float32Array(lastBufferPoints), 3));

      let dimensionLine2 = new THREE.Mesh(lastGeometry, this.lineMaterial);

      this.linesMeshes.push(dimensionLine2);

      this.viewer.overlays.addMesh(dimensionLine2, DimensionsOverlayName);
    }

  }

  _updateText(midpoint) {
    this._removeTextMesh();
    if (this.text != "") {
      this._addTextGeometry(midpoint);
    }

  }

  _removeText() {
    this.text = "";
    this._removeTextMesh();
    this.viewer.impl.sceneUpdated(true);
  }

  _removeTextMesh() {
    if (this.textMesh) {
      this.viewer.overlays.removeMesh(this.textMesh, DimensionsOverlayName);
      this.textMesh = null;
      this.viewer.impl.sceneUpdated(true);
    }
  }

  _addTextGeometry(midpoint) {
    //First we create the TextGeometry
    var textGeo = new THREE.TextGeometry(this.text, {
      font: this.fontName,
      size: this.fontSize,
      height: 0,
      curveSegments: 6,
    });

    //Here we compute the boundingbox as it's not done by default
    textGeo.computeBoundingBox();

    //Here we define the material for the geometry
    let textMaterial = this.material;

    //Here we create the mesh with TextGeometry and material defined previously
    let textMesh = new THREE.Mesh(textGeo, textMaterial);

    let meshBox = textMesh.geometry.boundingBox.max.clone().sub(textMesh.geometry.boundingBox.min);

    let curveVector = midpoint.clone().sub(this.points[0]);

    let auxVector = curveVector.clone().normalize().multiplyScalar(meshBox.length() * 0.5);

    let upAuxVector = new THREE.Vector3();

    if (meshBox.length() > 2 * (curveVector.length() - this.fontSize)) {
      upAuxVector = this.faceNormal.clone().multiplyScalar(this.fontSize);
    }

    this._alignTextMesh(textMesh, midpoint, curveVector);

    //Then, we set its position
    textMesh.position.x = midpoint.x + auxVector.x + upAuxVector.x;
    textMesh.position.y = midpoint.y + auxVector.y + upAuxVector.y;
    textMesh.position.z = midpoint.z + auxVector.z + upAuxVector.z;

    //and enable for shadows
    textMesh.castShadow = true;
    textMesh.receiveShadow = true;

    this.textMesh = textMesh;

    //Now we just need to add on a custom scene on viewer
    if (!this.viewer.overlays.hasScene(DimensionsOverlayName)) {
      this.viewer.overlays.addScene(DimensionsOverlayName);
    }
    this.viewer.overlays.addMesh(textMesh, DimensionsOverlayName);
    this.viewer.impl.sceneUpdated(true);
  }

  _alignTextMesh(mesh, midpoint, curveVector) {

    let targetDirection = this.faceNormal.clone().cross(curveVector).normalize();

    let targetPoint = midpoint.clone().add(targetDirection.multiplyScalar(9999999));

    mesh.up = curveVector.clone().cross(targetDirection).normalize();
    mesh.lookAt(targetPoint);

  }

  _reset() {
    this.points = [];
    this.textMesh = null;
    this.text = "";
    this.linesMeshes = [];
    this.faceNormal = null;
  }
}

class DimensionsToolExtension extends Autodesk.Viewing.Extension {
  constructor(viewer, options) {
    super(viewer, options);
    this.tool = new DimensionsTool(viewer);
    this.button = null;
  }

  async load() {
    await this.viewer.loadExtension('Autodesk.Snapping');
    this.viewer.toolController.registerTool(this.tool);
    console.log('DimensionsToolExtension has been loaded.');
    return true;
  }

  async unload() {
    this.viewer.toolController.deregisterTool(this.tool);
    console.log('DimensionsToolExtension has been unloaded.');
    return true;
  }

  onToolbarCreated(toolbar) {
    const controller = this.viewer.toolController;
    this.button = new Autodesk.Viewing.UI.Button('dimensions-tool-button');
    this.button.onClick = (ev) => {
      if (controller.isToolActivated(DimensionsToolName)) {
        controller.deactivateTool(DimensionsToolName);
        this.button.setState(Autodesk.Viewing.UI.Button.State.INACTIVE);
      } else {
        controller.activateTool(DimensionsToolName);
        this.button.setState(Autodesk.Viewing.UI.Button.State.ACTIVE);
      }
    };
    this.button.setToolTip('Dimensions Tool');
    this.group = new Autodesk.Viewing.UI.ControlGroup('dimensions-tool-group');
    this.group.addControl(this.button);
    toolbar.addControl(this.group);
  }
}

Autodesk.Viewing.theExtensionManager.registerExtension('DimensionsToolExtension', DimensionsToolExtension);
